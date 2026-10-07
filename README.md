# 十二音级和弦识别与低音转位解释后端

离线运行的**和弦结构识别服务**。输入一组**同时发声的 MIDI 整数音高**（0–127），
按十二平均律音级集合（pitch-class set）做**严格模板完全相等匹配**，返回支持的
**根音、和弦类型、低音转位及每个结构成分的实际音符来源**。

只做 API 与 CLI（纯后端，无界面）。不读取音频 / MIDI 文件，不识别调性、节拍、
旋律功能，也不做自动伴奏。技术栈：TypeScript + Node.js + 内置 `node:sqlite`
（无需 Docker / WSL / 在线服务 / 付费 API）。

## 设计原则（务必先读）

- **严格集合相等**：把输入音高模 12 去重得到音级集合；枚举根音 0–11，将模板平移模 12
  后与输入集合做**完全相等**比较。输入“包含”模板但有多余音 → 不匹配；输入顺序绝不参与判断。
- **根音不一定等于最低音**：根音来自集合匹配，低音始终是**原始整数音高的最小值**。
- **重复八度不增加成分**：识别按去重音级进行；但每个成分会回链所有实际输入音符，便于核对。
- **对称集合保留全部候选**：增三 `{0,4,8}` 有 3 个根音，减七 `{0,3,6,9}` 有 4 个根音；
  挂二 / 挂四也可能用不同根音描述同一集合（如 `{0,2,7}` = sus2 根音 0，也 = sus4 根音 7）。
  系统**不会**强行只给一个答案。
- **状态而非置信度**：`none`（无匹配）/ `unique`（唯一候选）/ `ambiguous`（歧义多候选）。
  不输出“调性置信度百分比”，因为本服务根本不判定调性。
- **音名仅为显示标签**：统一升号（C, C#, D …），核心结果始终使用音级编号 0–11，
  等音拼写（C#/Db）不影响匹配。

## 固定模板（版本 `fixed-v1`，顺序即结构成分次序）

| 类型 type | 名称 | 相对根音音程 |
|---|---|---|
| `major` | 大三和弦 | `[0,4,7]` |
| `minor` | 小三和弦 | `[0,3,7]` |
| `diminished` | 减三和弦 | `[0,3,6]` |
| `augmented` | 增三和弦 | `[0,4,8]` |
| `sus2` | 挂二 | `[0,2,7]` |
| `sus4` | 挂四 | `[0,5,7]` |
| `dominant7` | 属七 | `[0,4,7,10]` |
| `major7` | 大七 | `[0,4,7,11]` |
| `minor7` | 小七 | `[0,3,7,10]` |
| `halfDim7` | 半减七 | `[0,3,6,10]` |
| `diminished7` | 减七 | `[0,3,6,9]` |

模板下标即结构次序：0 根音、1 三音或挂留音、2 五音、3 七音。

## 转位如何确定

找到匹配后，取**最低音**（原始 MIDI 最小值）的音级，计算它相对根音的上行音程，
再查它落在模板的第几个成分：第 0 项 = 根位，第 1 项 = 第一转位，第 2 项 = 第二转位，
第 3 项 = 第三转位。挂留和弦也按同一套序号输出；这只是一种**结构化约定**，
并不声称音乐理论中挂留和弦只有这一种命名方式。

> 注意：对称和弦（增三 / 减七）在不同候选根音下，同一个低音会对应不同转位序号，
> 这是正常现象，全部候选都会保留。

## 环境要求

- Node.js ≥ 22.5（推荐 Node 23+/25）。SQLite 使用内置实验模块 `node:sqlite`，
  首次运行会打印一行 experimental 警告，功能正常，无需安装任何原生依赖。
- Windows 本地 PowerShell 直接运行；npm 已内置，不需要 Docker / WSL。

## 安装与构建

```powershell
npm install
npm run build
```

## 测试

```powershell
npm test
```

测试为**手写固定期望**：用独立的集合多重集比较核对“全部候选”不多不少
（例如增三必须恰好是根音 0/4/8，减七恰好是 0/3/6/9，挂二/挂四双候选），
而不是只断言“存在某个候选”。覆盖输入重排、不同八度、边界音高 0/127、
非法小数、越界、空集合、超 64 音、幂等、重启读取成分来源、HTTP API 等。

## 启动服务

```powershell
# 默认自动选择一个空闲端口，监听 127.0.0.1
npm start

# 指定端口
$env:PORT=3000; npm start

# 指定数据目录（默认 项目内 ./data）
$env:CHORD_DATA_DIR="E:\chord-data"; npm start
```

启动后控制台打印实际地址（如 `http://127.0.0.1:52373`）。

## 演示

```powershell
npm run demo
```

演示包含：C 大三根位 / 第一 / 第二转位、增三 3 候选、减七 4 候选、重复八度、
最低音变化只改转位、挂二挂四双候选、额外音无匹配、输入重排、非法小数、
转调与越界拒绝。

## CLI 用法

```powershell
node dist/src/cli.js recognize "[60,64,67]"   # 也支持逗号形式
node dist/src/cli.js recognize 64,67,72
node dist/src/cli.js preview "[60,72,64]"     # 只看规范音级 / 低音 / 成分来源
node dist/src/cli.js submit "[60,64,67]"      # 识别并入库（幂等）
node dist/src/cli.js list
node dist/src/cli.js explain <id> [候选序号]
node dist/src/cli.js report <id>              # 导出完整 JSON 报告
node dist/src/cli.js compare <idA> <idB>      # 比较两个配器
node dist/src/cli.js transpose "[60,64,67]" 12
node dist/src/cli.js demo
```

## HTTP API

所有请求 / 响应为 JSON。错误统一形如
`{"error":{"code":"...","message":"...","detail":...}}`。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/health` | 健康检查 |
| POST | `/preview` | 预览规范音级（不落库），body `{"notes":[...]}` |
| POST | `/recognize` | 识别全部候选（不落库） |
| POST | `/submissions` | 提交并持久化（幂等），新建返回 201，命中返回 200 |
| GET | `/submissions` | 列出全部报告 |
| GET | `/submissions/:id` | 读取某次识别（含全部候选） |
| GET | `/submissions/:id/candidates/:n` | 解释第 n 个候选的成分来源 |
| GET | `/submissions/:id/report` | 导出完整报告 |
| POST | `/compare` | 比较两个配器，body `{"aId":1,"bId":2}` |
| POST | `/transpose` | 转调演示 `{"notes":[...],"semitones":12,"persist":false}` |

```powershell
Invoke-RestMethod http://127.0.0.1:<端口>/recognize -Method Post `
  -ContentType 'application/json' -Body '{"notes":[60,64,68]}'
```

### 校验与错误码

| code | 含义 |
|---|---|
| `NOT_AN_ARRAY` | 输入不是数组 |
| `EMPTY_INPUT` | 空集合 |
| `TOO_MANY_NOTES` | 音符数 > 64 |
| `NOTE_NOT_INTEGER` | 含非整数（如 64.5）或非数字 |
| `NOTE_OUT_OF_RANGE` | 音符不在 0–127 |
| `SEMITONES_NOT_INTEGER` | 转调半音数不是整数 |
| `TRANSPOSE_OUT_OF_RANGE` | 转调后出现越界音符，**直接拒绝，不截断** |
| `INVALID_JSON` | 请求体不是合法 JSON |
| `NOT_FOUND` / `CANDIDATE_NOT_FOUND` / `ROUTE_NOT_FOUND` | 资源 / 路由不存在 |

## SQLite 持久化与幂等

数据库文件位于 `<数据目录>/chords.db`（WAL 模式）。表 `submissions` 保存：

- **输入顺序**（原样 JSON）、**规范音级集合**、**原始低音 MIDI**、**模板版本**；
- **完整候选 JSON**（每个候选的根音 / 类型 / 低音音程 / 转位序号 / 每个成分的实际音符），
  不只保存第一个标签。

幂等指纹 = 排序音级 + 低音 MIDI：

- 重复八度、输入重排 → 同一指纹，返回同一条记录（响应带 `idempotent:true`）；
- 整体挪到别的八度导致**最低音变化** → 视为**另一种配器**，独立保存，
  原报告不会被新配器覆盖；
- 非法输入直接 4xx，**不写入**正常报告；
- 重启进程后重新打开库，仍可读取各候选的成分来源（有测试覆盖）。

`/transpose` 默认只演示、**不落库**；显式 `persist:true` 才保存为独立配器。

## 已知限制

- 只支持上述 11 个固定模板；**不支持**省略音、附加音（add）、变化音、转调标记、
  自定义模板、复合和弦 / 多和弦分割。
- 只处理显式整数音高的同时发声集合；不解析音频、MIDI 文件、力度、时间、踏板。
- 不做调性 / 功能和声判断，根音是“模板平移意义上的集合根音”，不是调性主音。
- 音名统一升号、仅作显示；同音异名不产生不同结果。
- 转位序号是按模板成分位置的结构化约定，不保证等同于所有理论教材对
  挂留 / 对称和弦的命名称法。

## 目录结构

```
src/
  music.ts    核心：校验 / 规范化 / 严格集合匹配 / 转调（纯函数）
  db.ts       SQLite 持久化与幂等
  compare.ts  配器比较
  server.ts   HTTP API（默认空闲端口）
  cli.ts      命令行与内置 demo
test/         node:test 手写固定期望测试
data/         默认项目内数据目录（chords.db 运行后生成）
```
