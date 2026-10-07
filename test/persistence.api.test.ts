import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AddressInfo } from 'node:net';
import { openDatabase, saveSubmission, listSubmissions, getSubmission } from '../src/db.js';
import { recognize } from '../src/music.js';
import { compareVoicings } from '../src/compare.js';
import { createApp } from '../src/server.js';
import type { Server } from 'node:http';

let dir: string;

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'chord-test-'));
});

describe('SQLite 持久化', () => {
  test('保存全部候选，重启式重开库后可读取成分来源', () => {
    const path = join(dir, 'p1.db');
    const db1 = openDatabase(path);
    const saved = saveSubmission(db1, recognize([60, 63, 66, 69]));
    assert.equal(saved.created, true);
    assert.equal(saved.submission.result.candidates.length, 4);
    assert.equal(saved.submission.status, 'ambiguous');
    db1.close();

    // 重新打开 = 模拟重启
    const db2 = openDatabase(path);
    const loaded = getSubmission(db2, saved.submission.id)!;
    assert.equal(loaded.result.candidates.length, 4);
    assert.deepEqual(JSON.parse(loaded.input_order), [60, 63, 66, 69]);
    assert.deepEqual(JSON.parse(loaded.pitch_classes), [0, 3, 6, 9]);
    assert.equal(loaded.bass_midi, 60);
    // 成分来源可核对
    assert.deepEqual(loaded.result.candidates[0]!.components[0]!.sourceNotes, [60]);
    db2.close();
  });

  test('幂等：重复八度与重排命中同一记录，不新建', () => {
    const db = openDatabase(join(dir, 'p2.db'));
    const first = saveSubmission(db, recognize([60, 64, 67]));
    const dupOctaves = saveSubmission(db, recognize([60, 72, 76, 67, 64]));
    const reordered = saveSubmission(db, recognize([67, 60, 64]));
    assert.equal(dupOctaves.created, false);
    assert.equal(reordered.created, false);
    assert.equal(first.submission.id, dupOctaves.submission.id);
    assert.equal(listSubmissions(db).length, 1);
    db.close();
  });

  test('低音不同 = 不同配器，各自独立保存（原报告不被覆盖）', () => {
    const db = openDatabase(join(dir, 'p3.db'));
    const rootPos = saveSubmission(db, recognize([60, 64, 67]));
    const firstInv = saveSubmission(db, recognize([64, 67, 72]));
    assert.notEqual(rootPos.submission.id, firstInv.submission.id);
    // 原报告仍是根位
    assert.equal(getSubmission(db, rootPos.submission.id)!.result.candidates[0]!.inversion, 0);
    assert.equal(getSubmission(db, firstInv.submission.id)!.result.candidates[0]!.inversion, 1);
    db.close();
  });

  test('compare：八度排列不同但候选一致、低音不同', () => {
    const cmp = compareVoicings(recognize([60, 64, 67]), recognize([64, 67, 72]));
    assert.equal(cmp.samePitchClassSet, true);
    assert.equal(cmp.sameCandidateKeys, true);
    assert.equal(cmp.sameBass, false);
  });
});

describe('HTTP API', () => {
  let server: Server;
  let base: string;
  let db: ReturnType<typeof openDatabase>;

  before(async () => {
    db = openDatabase(join(dir, 'api.db'));
    server = createApp(db);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;
    base = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    db.close();
  });

  async function call(method: string, path: string, body?: unknown) {
    const res = await fetch(base + path, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await res.json();
    return { status: res.status, json };
  }

  test('GET /health', async () => {
    const { status, json } = await call('GET', '/health');
    assert.equal(status, 200);
    assert.equal(json.ok, true);
  });

  test('POST /recognize 返回增三 3 候选', async () => {
    const { status, json } = await call('POST', '/recognize', { notes: [60, 64, 68] });
    assert.equal(status, 200);
    assert.equal(json.status, 'ambiguous');
    assert.equal(json.candidates.length, 3);
  });

  test('非法输入返回错误码且 400', async () => {
    const { status, json } = await call('POST', '/recognize', { notes: [1.5] });
    assert.equal(status, 400);
    assert.equal(json.error.code, 'NOTE_NOT_INTEGER');
  });

  test('提交幂等 + 解释候选 + 导出报告 + 比较配器', async () => {
    const s1 = await call('POST', '/submissions', { notes: [60, 64, 67] });
    assert.equal(s1.status, 201);
    // 同低音的八度重复 + 重排才幂等；整体上移八度低音也变，属于另一配器
    const s1dup = await call('POST', '/submissions', { notes: [60, 72, 67, 64] });
    assert.equal(s1dup.status, 200);
    assert.equal(s1dup.json.idempotent, true);
    assert.equal(s1dup.json.id, s1.json.id);

    const s2 = await call('POST', '/submissions', { notes: [64, 67, 72] });
    const idA = s1.json.id as number;
    const idB = s2.json.id as number;

    const explained = await call('GET', `/submissions/${idA}/candidates/0`);
    assert.equal(explained.status, 200);
    assert.deepEqual(
      explained.json.candidate.components.map((x: { sourceNotes: number[] }) => x.sourceNotes),
      [[60], [64], [67]]
    );

    const report = await call('GET', `/submissions/${idA}/report`);
    assert.equal(report.json.recognition.templateVersion, 'fixed-v1');

    const cmp = await call('POST', '/compare', { aId: idA, bId: idB });
    assert.equal(cmp.json.comparison.sameCandidateKeys, true);
    assert.equal(cmp.json.comparison.sameBass, false);
  });

 test('转调默认不持久化，persist=true 才落库且不覆盖原报告', async () => {
    const before = await call('GET', '/submissions');
    const t = await call('POST', '/transpose', { notes: [60, 64, 67], semitones: 12 });
    assert.deepEqual(t.json.transposedNotes, [72, 76, 79]);
    assert.equal(t.json.persisted, null);
    const afterNoSave = await call('GET', '/submissions');
    assert.equal(afterNoSave.json.submissions.length, before.json.submissions.length);

    const t2 = await call('POST', '/transpose', { notes: [60, 64, 67], semitones: 12, persist: true });
    assert.ok(t2.json.persisted); // 显式 persist 才落库（低音不同，为独立新配器）
    assert.equal(t2.json.persisted.idempotent, false);
  });

  test('转调越界 400 拒绝', async () => {
    const { status, json } = await call('POST', '/transpose', { notes: [127], semitones: 1 });
    assert.equal(status, 400);
    assert.equal(json.error.code, 'TRANSPOSE_OUT_OF_RANGE');
  });

  test('未知路由 404', async () => {
    const { status } = await call('GET', '/nope');
    assert.equal(status, 404);
  });
});

test('清理临时目录', async () => {
  // 等待 Windows 释放 WAL 句柄后再清理
  await new Promise((r) => setTimeout(r, 100));
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});
