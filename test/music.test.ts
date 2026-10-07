import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TEMPLATES,
  ValidationError,
  preview,
  recognize,
  transpose,
  type RecognitionResult,
} from '../src/music.js';

function keys(result: RecognitionResult): Array<[number, string]> {
  return result.candidates.map((c) => [c.rootPc, c.type]);
}

// 独立集合比较：候选的 (根音,类型) 多重集必须与固定期望完全相等，
// 不多不少，不只断言“存在某一个”。
function expectCandidates(result: RecognitionResult, expected: Array<[number, string]>): void {
  const normActual = keys(result).map((k) => k.join(':')).sort();
  const normExpected = expected.map((k) => k.join(':')).sort();
  assert.deepEqual(normActual, normExpected);
}

test('模板本身合法：音级唯一且根音为 0', () => {
  for (const t of TEMPLATES) {
    assert.equal(t.intervals[0], 0);
    assert.equal(new Set(t.intervals).size, t.intervals.length, `${t.type} 音级重复`);
    for (const iv of t.intervals) assert.ok(iv >= 0 && iv <= 11);
  }
});

test('[60,64,67] = C 大三根位，唯一候选', () => {
  const r = recognize([60, 64, 67]);
  assert.equal(r.status, 'unique');
  expectCandidates(r, [[0, 'major']]);
  const c = r.candidates[0]!;
  assert.equal(c.inversion, 0);
  assert.equal(c.bassMidi, 60);
  assert.equal(c.bassIntervalFromRoot, 0);
  assert.deepEqual(r.pitchClasses, [0, 4, 7]);
});

test('[64,67,72] = 同一和弦第一转位，低音是三音', () => {
  const r = recognize([64, 67, 72]);
  assert.equal(r.status, 'unique');
  expectCandidates(r, [[0, 'major']]);
  const c = r.candidates[0]!;
  assert.equal(c.inversion, 1);
  assert.equal(c.bassMidi, 64);
  assert.equal(c.bassIntervalFromRoot, 4);
});

test('[55,60,64] = 第二转位，低音是五音', () => {
  const r = recognize([55, 60, 64]);
  expectCandidates(r, [[0, 'major']]);
  const c = r.candidates[0]!;
  assert.equal(c.inversion, 2);
  assert.equal(c.bassMidi, 55);
  assert.equal(c.bassIntervalFromRoot, 7);
});

test('根音不等于最低音：第一转位根音仍为 0，而非低音 4', () => {
  const r = recognize([64, 67, 72]);
  assert.equal(r.candidates[0]!.rootPc, 0);
  assert.notEqual(r.candidates[0]!.rootPc, r.candidates[0]!.bassPc);
});

test('[60,64,68] 增三保留根音 0/4/8 全部三个候选', () => {
  const r = recognize([60, 64, 68]);
  assert.equal(r.status, 'ambiguous');
  expectCandidates(r, [[0, 'augmented'], [4, 'augmented'], [8, 'augmented']]);
});

test('减七对称集合保留四个根音候选', () => {
  const r = recognize([60, 63, 66, 69]);
  assert.equal(r.status, 'ambiguous');
  expectCandidates(r, [
    [0, 'diminished7'],
    [3, 'diminished7'],
    [6, 'diminished7'],
    [9, 'diminished7'],
  ]);
});

test('挂二与挂四可描述同一集合：[0,2,7] 双候选', () => {
  // sus2 根音 0 => {0,2,7}；sus4 根音 7 => {7,0,2}
  const r = recognize([60, 62, 67]);
  assert.equal(r.status, 'ambiguous');
  expectCandidates(r, [[0, 'sus2'], [7, 'sus4']]);
});

test('重复八度不增加成分：含重复音的 C 大三仍唯一', () => {
  const r = recognize([48, 60, 64, 67, 72, 76]);
  assert.deepEqual(r.pitchClasses, [0, 4, 7]);
  assert.equal(r.status, 'unique');
  expectCandidates(r, [[0, 'major']]);
  // 根音成分必须能核对到两个八度的实际音符
  const rootComp = r.candidates[0]!.components[0]!;
  assert.deepEqual(rootComp.sourceNotes, [48, 60, 72]);
});

test('最低音变化只影响转位：换低音不改候选根音与类型', () => {
  const rootPos = recognize([60, 64, 67]);
  const firstInv = recognize([64, 67, 72]);
  assert.deepEqual(keys(rootPos), keys(firstInv));
  assert.equal(rootPos.candidates[0]!.inversion, 0);
  assert.equal(firstInv.candidates[0]!.inversion, 1);
});

test('输入重排不改变结果，且顺序原样保留', () => {
  const a = recognize([60, 64, 67]);
  const b = recognize([67, 60, 64]);
  expectCandidates(a, keys(b));
  assert.deepEqual(b.inputNotes, [67, 60, 64]);
  assert.deepEqual(a.pitchClasses, b.pitchClasses);
});

test('不同八度相同音级得到相同候选', () => {
  const a = recognize([0, 4, 7]);
  const b = recognize([12, 16, 31]);
  expectCandidates(a, keys(b));
});

test('多余音导致严格不匹配：[60,64,67,68] 无匹配但返回规范集合', () => {
  const r = recognize([60, 64, 67, 68]);
  assert.equal(r.status, 'none');
  assert.equal(r.candidates.length, 0);
  assert.deepEqual(r.pitchClasses, [0, 4, 7, 8]);
  assert.equal(r.pitchClassSetLabel, '{0,4,7,8}');
});

test('单音无匹配', () => {
  const r = recognize([60]);
  assert.equal(r.status, 'none');
  assert.deepEqual(r.pitchClasses, [0]);
});

test('空集合拒绝', () => {
  assert.throws(() => recognize([]), (e: Error) => e instanceof ValidationError && e.code === 'EMPTY_INPUT');
});

test('非法小数拒绝', () => {
  assert.throws(() => recognize([60, 64.5, 67]), (e: Error) =>
    e instanceof ValidationError && e.code === 'NOTE_NOT_INTEGER');
});

test('越界音高拒绝（-1 与 128）', () => {
  assert.throws(() => recognize([-1, 4, 7]), (e: Error) =>
    e instanceof ValidationError && e.code === 'NOTE_OUT_OF_RANGE');
  assert.throws(() => recognize([128]), (e: Error) =>
    e instanceof ValidationError && e.code === 'NOTE_OUT_OF_RANGE');
});

test('边界音高 0 与 127 合法', () => {
  assert.equal(recognize([0, 4, 7]).status, 'unique');
  const r = recognize([127, 123, 120]); // {0,3,7} = 小三根音 120(pc0)
  expectCandidates(r, [[0, 'minor']]);
});

test('超过 64 个音符拒绝', () => {
  const notes = Array.from({ length: 65 }, (_, i) => 60 + (i % 12));
  assert.throws(() => recognize(notes), (e: Error) =>
    e instanceof ValidationError && e.code === 'TOO_MANY_NOTES');
});

test('非数组与非数字拒绝', () => {
  assert.throws(() => recognize('60,64'), (e: Error) =>
    e instanceof ValidationError && e.code === 'NOT_AN_ARRAY');
  assert.throws(() => recognize([60, '64', 67]), (e: Error) =>
    e instanceof ValidationError && e.code === 'NOTE_NOT_INTEGER');
});

test('全部 11 种模板均可在根音 0 被识别', () => {
  for (const t of TEMPLATES) {
    const r = recognize(t.intervals);
    assert.ok(r.candidates.some((c) => c.rootPc === 0 && c.type === t.type), t.type);
  }
});

test('七和弦转位序号到 3：小七第三转位低音为七音', () => {
  // 小七 [0,3,7,10]，根音 0，低音 pc10(midi70) => inversion 3
  const r = recognize([70, 72, 75, 79]);
  const c = r.candidates.find((x) => x.rootPc === 0 && x.type === 'minor7');
  assert.ok(c);
  assert.equal(c!.inversion, 3);
  assert.equal(c!.bassIntervalFromRoot, 10);
});

test('候选排序稳定：先根音编号，再固定模板顺序', () => {
  const r = recognize([60, 63, 66, 69]);
  const ks = keys(r);
  const sorted = [...ks].sort((a, b) => a[0] - b[0]);
  assert.deepEqual(ks, sorted);
});

test('preview 返回每个音级的原始音符来源与低音', () => {
  const p = preview([67, 60, 72]);
  assert.deepEqual(p.pitchClasses, [0, 7]);
  assert.deepEqual(p.sourcesByPc[0], [60, 72]);
  assert.deepEqual(p.sourcesByPc[7], [67]);
  assert.equal(p.bassMidi, 60);
});

test('转调整体平移半音，越界拒绝而不截断', () => {
  assert.deepEqual(transpose([60, 64, 67], 12), [72, 76, 79]);
  assert.throws(() => transpose([120, 124, 127], 20), (e: Error) =>
    e instanceof ValidationError && e.code === 'TRANSPOSE_OUT_OF_RANGE');
  assert.throws(() => transpose([0, 4, 7], -1), (e: Error) =>
    e instanceof ValidationError && e.code === 'TRANSPOSE_OUT_OF_RANGE');
  assert.throws(() => transpose([60], 1.5), (e: Error) =>
    e instanceof ValidationError && e.code === 'SEMITONES_NOT_INTEGER');
});

test('音名仅为升号显示标签，核心用音级编号', () => {
  const c = recognize([61, 65, 68]).candidates[0]!;
  assert.equal(c.rootPc, 1);
  assert.equal(c.rootName, 'C#');
});
