import { test } from "node:test";
import assert from "node:assert/strict";
import { recognize, normalize, transpose, TEMPLATES } from "../src/theory.js";
import { ValidationError } from "../src/errors.js";

function keys(c: { root: number; type: string }[]): string[] {
  return c.map((x) => `${x.root}:${x.type}`).sort();
}

test("[60,64,67] 为 C 大三根位，唯一候选", () => {
  const r = recognize([60, 64, 67]);
  assert.equal(r.status, "unique");
  assert.deepEqual(r.pitchClasses, [0, 4, 7]);
  assert.equal(r.bass, 60);
  assert.deepEqual(keys(r.candidates), ["0:major"]);
  const c = r.candidates[0]!;
  assert.equal(c.root, 0);
  assert.equal(c.inversion, 0);
  assert.equal(c.bassIntervalFromRoot, 0);
});

test("[64,67,72] 为同一 C 大三的第一转位", () => {
  const r = recognize([64, 67, 72]);
  assert.equal(r.status, "unique");
  assert.deepEqual(keys(r.candidates), ["0:major"]);
  const c = r.candidates[0]!;
  assert.equal(c.inversion, 1);
  assert.equal(c.bass, 4);
  assert.equal(c.bassIntervalFromRoot, 4);
});

test("[55,60,64] 为第二转位", () => {
  const r = recognize([55, 60, 64]);
  const c = r.candidates[0]!;
  assert.equal(r.status, "unique");
  assert.equal(c.root, 0);
  assert.equal(c.inversion, 2);
  assert.equal(c.bass, 7);
});

test("[60,64,68] 增三保留根音 0/4/8 全部候选", () => {
  const r = recognize([60, 64, 68]);
  assert.equal(r.status, "ambiguous");
  assert.deepEqual(keys(r.candidates), ["0:augmented", "4:augmented", "8:augmented"]);
  // 稳定排序：根音升序
  assert.deepEqual(r.candidates.map((c) => c.root), [0, 4, 8]);
});

test("减七对称集合保留四个根音候选", () => {
  const r = recognize([60, 63, 66, 69]);
  assert.equal(r.status, "ambiguous");
  assert.equal(r.candidates.length, 4);
  assert.deepEqual(r.candidates.map((c) => c.root), [0, 3, 6, 9]);
  assert.ok(r.candidates.every((c) => c.type === "diminished7"));
});

test("挂二挂四双候选：[0,2,7] 同时是 root0 sus2 与 root7 sus4", () => {
  const r = recognize([60, 62, 67]);
  assert.equal(r.status, "ambiguous");
  assert.deepEqual(keys(r.candidates), ["0:sus2", "7:sus4"]);
});

test("重复八度不改变音级匹配，且成分来源保留全部原始音符", () => {
  const r = recognize([60, 64, 67, 72, 76, 60]);
  assert.deepEqual(r.pitchClasses, [0, 4, 7]);
  assert.equal(r.status, "unique");
  const rootComp = r.candidates[0]!.components.find((c) => c.componentIndex === 0)!;
  assert.deepEqual(rootComp.sourceNotes, [60, 60, 72]);
});

test("加入额外音导致完全相等匹配失败 → 无匹配并给规范集合", () => {
  // {0,2,4,7,9} 五个音级，没有任何固定模板可完全相等
  const r = recognize([60, 62, 64, 67, 69]);
  assert.equal(r.status, "no_match");
  assert.deepEqual(r.pitchClasses, [0, 2, 4, 7, 9]);
  assert.deepEqual(r.candidates, []);
});

test("单音无匹配", () => {
  const r = recognize([60]);
  assert.equal(r.status, "no_match");
  assert.deepEqual(r.pitchClasses, [0]);
});

test("输入重排不影响候选，且顺序不影响稳定排序", () => {
  const a = recognize([67, 60, 64]);
  const b = recognize([64, 67, 60]);
  assert.deepEqual(keys(a.candidates), keys(b.candidates));
  assert.deepEqual(a.candidates.map((c) => [c.root, c.type]), b.candidates.map((c) => [c.root, c.type]));
});

test("不同八度同一音级集合、低音随原始最小值变化", () => {
  const low = recognize([48, 52, 55]);
  assert.equal(low.bass, 48);
  assert.deepEqual(keys(low.candidates), ["0:major"]);
  const firstInv = recognize([52, 55, 60]);
  assert.equal(firstInv.candidates[0]!.inversion, 1);
});

test("边界音高 0 与 127 合法", () => {
  assert.doesNotThrow(() => normalize([0, 127]));
  const r = recognize([0, 4, 7]);
  assert.equal(r.status, "unique");
});

test("全部 11 个模板均可被识别", () => {
  for (const t of TEMPLATES) {
    const notes = t.intervals;
    const r = recognize(notes);
    assert.ok(
      r.candidates.some((c) => c.root === 0 && c.type === t.type),
      `模板 ${t.type} 应在 root=0 匹配`,
    );
  }
});

test("小七与属七等四音模板的第三转位", () => {
  // G 小七 {G,Bb,D,F}，最低音为 Bb(pc5=相对根音 10) → 第三转位
  const r = recognize([77, 79, 82, 86]);
  const c = r.candidates.find((x) => x.root === 7 && x.type === "minor7")!;
  assert.ok(c);
  assert.equal(c.inversion, 3);
  assert.equal(c.bassIntervalFromRoot, 10);
});

test("非法小数被拒绝", () => {
  assert.throws(() => recognize([60, 64.5, 67]), (e: unknown) =>
    e instanceof ValidationError && e.code === "NON_INTEGER_NOTE");
});

test("空集合拒绝", () => {
  assert.throws(() => recognize([]), (e: unknown) =>
    e instanceof ValidationError && e.code === "EMPTY_INPUT");
});

test("越界音高拒绝", () => {
  assert.throws(() => recognize([60, 128]), (e: unknown) =>
    e instanceof ValidationError && e.code === "NOTE_OUT_OF_RANGE");
  assert.throws(() => recognize([-1]), (e: unknown) =>
    e instanceof ValidationError && e.code === "NOTE_OUT_OF_RANGE");
});

test("超过 64 个音符拒绝", () => {
  assert.throws(() => recognize(Array(65).fill(60)), (e: unknown) =>
    e instanceof ValidationError && e.code === "TOO_MANY_NOTES");
});

test("非数字音符拒绝", () => {
  assert.throws(
    () => recognize([60, "64" as unknown as number]),
    (e: unknown) => e instanceof ValidationError && e.code === "INVALID_NOTE_TYPE",
  );
});

test("转调整体平移且超范围拒绝不截断", () => {
  assert.deepEqual(transpose([60, 64, 67], 2).notes, [62, 66, 69]);
  assert.throws(() => transpose([126, 127], 5), (e: unknown) =>
    e instanceof ValidationError && e.code === "MIDI_OUT_OF_RANGE_TRANSPOSE");
  assert.throws(() => transpose([0], -1), (e: unknown) =>
    e instanceof ValidationError && e.code === "MIDI_OUT_OF_RANGE_TRANSPOSE");
});

