import { join } from "node:path";
import { ChordStore } from "../src/db.js";
import { recognize, transpose } from "../src/theory.js";
import { buildReport, compareResults } from "../src/report.js";

function heading(title: string): void {
  console.log(`\n=== ${title} ===`);
}

heading("1. C 大三根位 [60,64,67]");
console.log(JSON.stringify(recognize([60, 64, 67]).candidates, null, 2));

heading("2. 同一和弦第一转位 [64,67,72]（最低音为三音 E）");
console.log(recognize([64, 67, 72]).candidates.map((c) => `${c.rootName} ${c.typeLabel} / ${c.inversionLabel}`));

heading("3. 第二转位 [55,60,64]（最低音为五音 G）");
console.log(recognize([55, 60, 64]).candidates.map((c) => `${c.rootName} ${c.typeLabel} / ${c.inversionLabel}`));

heading("4. 增三 [60,64,68] 保留根音 0/4/8 三个候选");
console.log(recognize([60, 64, 68]).candidates.map((c) => `root=${c.root}(${c.rootName})`));

heading("5. 减七 [60,63,66,69] 四根歧义");
console.log(recognize([60, 63, 66, 69]).candidates.map((c) => `root=${c.root}(${c.rootName})`));

heading("6. 重复八度 [60,64,67,72,76] 不改变音级匹配");
const oct = recognize([60, 64, 67, 72, 76]);
console.log(`音级=[${oct.pitchClasses}] 候选数=${oct.candidates.length} 状态=${oct.status}`);
console.log("根音成分来源音符:", oct.candidates[0]?.components[0]?.sourceNotes);

heading("7. 最低音变化只影响转位（音级相同）");
console.log(JSON.stringify(compareResults(recognize([60, 64, 67]), recognize([64, 67, 72])), null, 2));

heading("8. 挂二/挂四双候选 [60,62,67]");
console.log(recognize([60, 62, 67]).candidates.map((c) => `root=${c.rootName} ${c.typeLabel}`));

heading("9. 加入额外音 [60,62,64,67,69] → 五音集合无匹配");
const extra = recognize([60, 62, 64, 67, 69]);
console.log(`状态=${extra.status} 规范音级=[${extra.pitchClasses}]`);

heading("10. 转调演示：[60,64,67] +2 半音");
console.log(transpose([60, 64, 67], 2));
heading("    上边界拒绝：[126,127] +5 不截断");
try {
  transpose([126, 127], 5);
} catch (e) {
  console.log(`拒绝: ${(e as Error).message}`);
}

heading("11. SQLite 持久化：保存两份不同配器并读取候选成分来源");
const store = new ChordStore(join(process.cwd(), "data", "chords.sqlite"));
const first = store.recognizeAndStore([60, 64, 67]);
const second = store.recognizeAndStore([64, 67, 72]);
console.log(`报告1 id=${first.id} 状态=${first.status}（重复提交 reused=${store.recognizeAndStore([60, 64, 67]).reused}）`);
console.log(`报告2 id=${second.id} 状态=${second.status}（原报告未被覆盖: ${first.id !== second.id}）`);
const reloaded = store.getById(first.id)!;
console.log("重启后读取报告1成分来源:", JSON.stringify(reloaded.candidates[0]?.components.map((c) => c.sourceNotes)));
console.log("\n导出报告片段:\n", JSON.stringify(buildReport(first.inputNotes, recognize(first.inputNotes)), null, 2).slice(0, 400));
store.close();
