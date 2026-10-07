// SQLite 持久化：输入顺序、规范集合、原始低音、模板版本、完整候选全部保存。

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { RecognitionResult } from './music.js';

export interface StoredSubmission {
  id: number;
  created_at: string;
  input_order: string;
  pitch_classes: string;
  bass_midi: number;
  template_version: string;
  status: string;
  result: RecognitionResult;
}

export function openDatabase(dbPath: string): DatabaseSync {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS submissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      -- 规范化指纹：排序后的音级 + 低音 MIDI（低音不同则转位不同，视为不同配器）
      fingerprint TEXT NOT NULL,
      input_order TEXT NOT NULL,
      pitch_classes TEXT NOT NULL,
      bass_midi INTEGER NOT NULL,
      template_version TEXT NOT NULL,
      status TEXT NOT NULL,
      -- 完整结果（含每个候选的成分来源），不只是第一个标签
      result_json TEXT NOT NULL
    );
  `);
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_submissions_fingerprint
    ON submissions(fingerprint);
  `);
  return db;
}

// 指纹包含低音，故“最低音变化只影响转位”会产生不同配器记录，
// 但重复八度 / 输入重排共享同一指纹，保证请求幂等。
export function fingerprint(result: RecognitionResult): string {
  return result.pitchClasses.join(',') + '|bass=' + result.bassMidi;
}

export interface SaveResult {
  submission: StoredSubmission;
  created: boolean; // false = 幂等命中已有记录
}

export function saveSubmission(db: DatabaseSync, result: RecognitionResult): SaveResult {
  const fp = fingerprint(result);
  const existing = findByFingerprint(db, fp);
  if (existing) return { submission: existing, created: false };

  db.prepare(`
    INSERT INTO submissions
      (fingerprint, input_order, pitch_classes, bass_midi, template_version, status, result_json)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    fp,
    JSON.stringify(result.inputNotes),
    JSON.stringify(result.pitchClasses),
    result.bassMidi,
    result.templateVersion,
    result.status,
    JSON.stringify(result)
  );
  const created = findByFingerprint(db, fp);
  if (!created) throw new Error('保存后无法读取提交记录');
  return { submission: created, created: true };
}

function rowToStored(row: unknown): StoredSubmission | null {
  if (!row) return null;
  const r = row as Record<string, unknown>;
  return {
    id: Number(r.id),
    created_at: String(r.created_at),
    input_order: String(r.input_order),
    pitch_classes: String(r.pitch_classes),
    bass_midi: Number(r.bass_midi),
    template_version: String(r.template_version),
    status: String(r.status),
    result: JSON.parse(String(r.result_json)) as RecognitionResult,
  };
}

export function findByFingerprint(db: DatabaseSync, fp: string): StoredSubmission | null {
  const row = db.prepare('SELECT * FROM submissions WHERE fingerprint = ?').get(fp);
  return rowToStored(row);
}

export function getSubmission(db: DatabaseSync, id: number): StoredSubmission | null {
  const row = db.prepare('SELECT * FROM submissions WHERE id = ?').get(id);
  return rowToStored(row);
}

export function listSubmissions(db: DatabaseSync): StoredSubmission[] {
  const rows = db.prepare('SELECT * FROM submissions ORDER BY id ASC').all();
  return rows.map((r) => rowToStored(r)!).filter(Boolean);
}

export function exportReport(db: DatabaseSync, id: number): object | null {
  const stored = getSubmission(db, id);
  if (!stored) return null;
  return {
    report: {
      id: stored.id,
      createdAt: stored.created_at,
      templateVersion: stored.template_version,
    },
    recognition: stored.result,
  };
}
