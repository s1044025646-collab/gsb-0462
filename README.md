# 十二音级和弦识别与低音转位解释后端

离线运行的和弦**结构**识别服务：输入一组同时发声的 MIDI 整数音高（0–127），按十二平均律音级集合（pitch-class set）识别固定模板和弦的根音、类型与低音转位。只提供 HTTP API 与 CLI，不读取音频或 MIDI 文件，不做调性、节拍、旋律功能或自动伴奏分析。

- 运行时：Node.js（建议 ≥ 22.5，本项目在 Node 25 上验证）+ TypeScript
- 数据库：内置 `node:sqlite`，无需安装原生模块、Docker、WSL 或任何在线服务
- 数据目录：项目内 `data/`（SQLite 文件 `data/chords.sqlite`）

## 识别规则与严格限制

### 固定模板（相对根音半音，顺序即结构成分次序）

| 顺序 | 类型 | 模板 | 成分次序 |
| --- | --- | --- | --- |
| 0 | 大三和弦 major | `[0,4,7]` | 根音/三音/五音 |
| 1 | 小三和弦 minor | `[0,3,7]` | 根音/三音/五音 |
| 2 | 减三和弦 diminished | `[0,3,6]` | 根音/三音/五音 |
| 3 | 增三和弦 augmented | `[0,4,8]` | 根音/三音/五音 |
| 4 | 挂二 sus2 | `[0,2,7]` | 根音/挂留音/五音 |
| 5 | 挂四 sus4 | `[0,5,7]` | 根音/挂留音/五音 |
| 6 | 属七 dominant7 | `[0,4,7,10]` | 根音/三音/五音/七音 |
| 7 | 大七 major7 | `[0,4,7,11]` | 根音/三音/五音/七音 |
| 8 | 小七 minor7 | `[0,3,7,10]` | 根音/三音/五音/七音 |
| 9 | 半减七 half_diminished7 | `[0,3,6,10]` | 根音/三音/五音/七音 |
| 10 | 减七 diminished7 | `[0,3,6,9]` | 根音/三音/五音/七音 |

不支持省略音、附加音、转调和自定义模板。

### 严格模板匹配

1. 每个输入音符按 `note mod 12` 归入音级；识别对**去重后的音级集合**进行，重复音与多个八度不增加和弦成分（但保留在每个成分的 `sourceNotes` 中供核对）。
2. 枚举根音 0–11，把每个模板平移 12 取模，与输入音级集合做**完全相等**比较：音级数量与成员必须一致。输入只包含模板但有多余音 → 不匹配；缺音 → 不匹配；输入顺序不代表上行根位排列。
3. **根音不一定是最低音**。低音单独取原始整数音高的最小值（`Math.min(notes)`），其音级相对候选根音的音程决定转位序号。
4. **转位**：低音对应模板第 0 项为根位，第 1 项为第一转位，第 2 项为第二转位，第 3 项为第三转位。挂留和弦也按同一序号约定输出，不声称这是唯一的理论命名方式。
5. **歧义全部保留**：增三（集合每 4 半音对称）对同一集合给出根音 0/4/8 三个候选；减七给出 4 个；`{0,2,7}` 既是 C 挂二也是 G 挂四，两个候选都保留。服务**不挑选唯一答案、不输出置信度百分比、不判定调性**。
6. 候选按根音编号升序、同根音按上表固定模板顺序稳定排列，与输入顺序或数据库返回顺序无关。
7. 状态三态：`no_match`（含单音与无法完整匹配的集合）、`unique`、`ambiguous`。无匹配时仍返回规范音级集合。
8. 音名（`C C# D ... B`，统一升号）只是显示标签，所有核心结果以音级编号表示，等音拼写不影响匹配。

## 构建、测试、启动、演示

```powershell
npm install
npm run build       # tsc 输出到 dist/
npm test            # 编译并运行 node:test（21 个用例）
npm start           # 启动 HTTP 服务，默认自动选择空闲端口
npm run demo        # 运行全部演示场景（含持久化与转调边界）
```

可选环境变量：

- `PORT`：监听端口，默认 `0`（由操作系统分配空闲端口，启动日志输出实际端口）
- `CHORD_DATA_DIR`：数据目录，默认项目内 `./data`

启动示例：

```powershell
$env:PORT="8080"; npm start
```

## HTTP API

请求/响应均为 JSON。错误响应形如 `{"error":{"code":"...","message":"..."}}`。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/health` | 健康检查与模板版本 |
| POST | `/normalize` | 预览规范音级集合与原始低音（不写库） |
| POST | `/recognize` | 识别并持久化完整候选（幂等，返回 `id`） |
| POST | `/transpose` | 整体平移整数半音，超 MIDI 范围拒绝 |
| POST | `/compare` | 比较两个配器（音级集合/低音/和弦结构） |
| GET | `/arrangements` | 列出全部已保存报告 |
| GET | `/arrangements/:id` | 读取单份报告（含全部候选与成分来源） |
| GET | `/arrangements/:id/export` | 导出该配器的完整报告 JSON |

```powershell
$body = @{ notes = @(60,64,68) } | ConvertTo-Json
Invoke-RestMethod -Uri "http://localhost:8080/recognize" -Method Post -Body $body -ContentType "application/json"
```

### 幂等与持久化

- 报告 `id` 由「模板版本 + 输入音符序列」哈希决定；同一输入重复提交返回同一记录（`reused:true`），不新增行。
- 不同配器（如根位与第一转位）是不同记录，**新配器不会覆盖旧报告**。
- 库中保存输入顺序、规范音级集合、原始低音、模板版本与**完整候选数组**（含每个成分对应的实际输入音符），不只保存第一个标签；重启后可完整读回。
- 非法输入在写库前被拒绝，不产生正常报告。

### 错误码

| code | 含义 |
| --- | --- |
| `EMPTY_INPUT` | 音符数组为空 |
| `TOO_MANY_NOTES` | 音符数超过 64 |
| `INVALID_NOTE_TYPE` | 音符不是数字 / 为 Infinity / 请求体非数组 |
| `NON_INTEGER_NOTE` | 音符或半音数是小数等非整数 |
| `NOTE_OUT_OF_RANGE` | 音符超出 0–127 |
| `MIDI_OUT_OF_RANGE_TRANSPOSE` | 转调后超出 0–127，拒绝且不截断 |
| `INVALID_BODY` | 非 JSON 或缺少字段 |
| `NOT_FOUND` | 路径或报告不存在 |

## CLI

```powershell
npx chord ...                       # 或 node --experimental-sqlite dist/src/cli.js ...
node dist/src/cli.js recognize  --notes 60,64,67
node dist/src/cli.js submit     --notes 64,67,72
node dist/src/cli.js normalize  --notes 60,72
node dist/src/cli.js transpose  --notes 60,64 --semitones 2
node dist/src/cli.js compare    --a 60,64,67 --b 64,67,72
node dist/src/cli.js export     --notes 60,63,66,69
node dist/src/cli.js list
```

（`node dist/src/cli.js` 前可按需加 `--experimental-sqlite`；当前 Node 版本下 SQLite 为实验特性，会输出一条警告，不影响功能。）

## 演示要点

- `[60,64,67]` → C 大三根位；`[64,67,72]` → 同一和弦第一转位（最低音 E=三音）；`[55,60,64]` → 第二转位（最低音 G=五音）。
- `[60,64,68]` → 增三，根音 0、4、8 三个候选全部保留。
- `[60,63,66,69]` → 减七，根音 0/3/6/9 四个候选。
- `[60,62,67]` → C 挂二与 G 挂四两个候选。
- `[60,64,67,72,76]` → 重复八度，音级仍为 `{0,4,7}`，成分 `sourceNotes` 可核对重复来源。
- 最低音变化（其余音级不变）只改变转位与低音字段；五音集合（如 `{0,2,4,7,9}`）无任何模板可完全匹配，状态为 `no_match`。
- 转调 `[60,64,67] +2 → [62,66,69]`；`[126,127] +5` 超范围直接拒绝，不静默截断。

## 目录

```
src/theory.ts   校验、模板、严格集合匹配、转位、规范化、转调
src/db.ts       SQLite 持久化与幂等
src/report.ts   配器比较与报告导出
src/server.ts   HTTP API（默认空闲端口）
src/cli.ts      命令行
tests/          手写固定期望 + 独立集合比较的全部候选断言
scripts/demo.ts 演示脚本
```
