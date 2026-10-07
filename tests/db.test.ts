import { test } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { ChordStore } from "../src/db.js";
import { ValidationError } from "../src/errors.js";

const tmpDir = join(process.cwd(), "data", `test-${process.pid}`);

test("持久化全部候选、幂等且非法输入不保存；重启可读取成分来源", () => {
  const dbPath = join(tmpDir, "chords.sqlite");
  const store1 = new ChordStore(dbPath);
  const first = store1.recognizeAndStore([60, 64, 68]);
  assert.equal(first.candidates.length, 3);
  assert.equal(first.reused, false);

  // 不同配器产生独立报告，不覆盖原报告
  const second = store1.recognizeAndStore([64, 67, 72]);
  assert.notEqual(first.id, second.id);

  // 幂等：相同输入顺序命中同一行
  const again = store1.recognizeAndStore([60, 64, 68]);
  assert.equal(again.id, first.id);
  assert.equal(again.reused, true);
  store1.close();

  // 模拟重启：新实例从磁盘读取
  const store2 = new ChordStore(dbPath);
  const reloaded = store2.getById(first.id)!;
  assert.ok(reloaded);
  assert.equal(reloaded.candidates.length, 3);
  assert.deepEqual(reloaded.candidates.map((c) => c.root), [0, 4, 8]);
  assert.deepEqual(reloaded.pitchClasses, [0, 4, 8]);
  assert.equal(reloaded.templateVersion, "pc-chord-templates-v1");
  // 成分来源可核对
  assert.deepEqual(reloaded.candidates[0]!.components.map((c) => c.sourceNotes), [[60], [64], [68]]);
  store2.close();

  // 非法输入不保存任何正常报告
  const store3 = new ChordStore(dbPath);
  assert.throws(
    () => store3.recognizeAndStore([60.5, 64]),
    (e: unknown) => e instanceof ValidationError,
  );
  assert.throws(
    () => store3.recognizeAndStore([]),
    (e: unknown) => e instanceof ValidationError,
  );
  assert.equal(store3.list().length, 2);
  store3.close();

  rmSync(tmpDir, { recursive: true, force: true });
});

