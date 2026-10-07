import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createHash } from "node:crypto";
import {
  TEMPLATE_VERSION,
  recognize,
  type ChordCandidate,
  type RecognitionResult,
} from "./theory.js";

export interface StoredArrangement {
  id: string;
  inputNotes: number[];
  pitchClasses: number[];
  bass: number;
  templateVersion: string;
  status: RecognitionResult["status"];
  candidates: ChordCandidate[];
  createdAt: string;
  /** 幂等：命中已存在输入时为 true，不产生新行 */
  reused: boolean;
}

export class ChordStore {
  private readonly db: DatabaseSync;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS arrangements (
        id TEXT PRIMARY KEY,
        input_notes TEXT NOT NULL,
        pitch_classes TEXT NOT NULL,
        bass INTEGER NOT NULL,
        template_version TEXT NOT NULL,
        status TEXT NOT NULL,
        candidates TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
  }

  close(): void {
    this.db.close();
  }

  private static idFor(notes: number[]): string {
    return createHash("sha256")
      .update(`${TEMPLATE_VERSION}:${notes.join(",")}`)
      .digest("hex")
      .slice(0, 16);
  }

  /** 识别并持久化完整候选；同一输入顺序返回同一记录（幂等） */
  recognizeAndStore(notes: number[]): StoredArrangement {
    const result = recognize(notes);
    const id = ChordStore.idFor(notes);
    const existing = this.getById(id);
    if (existing) return { ...existing, reused: true };

    const createdAt = new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT INTO arrangements
        (id, input_notes, pitch_classes, bass, template_version, status, candidates, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      id,
      JSON.stringify(notes),
      JSON.stringify(result.pitchClasses),
      result.bass,
      result.templateVersion,
      result.status,
      JSON.stringify(result.candidates),
      createdAt,
    );
    return {
      id,
      inputNotes: notes,
      pitchClasses: result.pitchClasses,
      bass: result.bass,
      templateVersion: result.templateVersion,
      status: result.status,
      candidates: result.candidates,
      createdAt,
      reused: false,
    };
  }

  getById(id: string): StoredArrangement | null {
    const row = this.db.prepare("SELECT * FROM arrangements WHERE id = ?").get(id) as
      | Record<string, unknown>
      | undefined;
    if (!row) return null;
    return this.hydrate(row);
  }

  list(): StoredArrangement[] {
    const rows = this.db
      .prepare("SELECT * FROM arrangements ORDER BY created_at ASC, id ASC")
      .all() as Record<string, unknown>[];
    return rows.map((r) => this.hydrate(r));
  }

  private hydrate(row: Record<string, unknown>): StoredArrangement {
    return {
      id: String(row.id),
      inputNotes: JSON.parse(String(row.input_notes)) as number[],
      pitchClasses: JSON.parse(String(row.pitch_classes)) as number[],
      bass: Number(row.bass),
      templateVersion: String(row.template_version),
      status: String(row.status) as RecognitionResult["status"],
      candidates: JSON.parse(String(row.candidates)) as ChordCandidate[],
      createdAt: String(row.created_at),
      reused: false,
    };
  }
}
