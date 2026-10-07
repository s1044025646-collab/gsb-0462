#!/usr/bin/env node
import { join } from "node:path";
import { ChordStore } from "./db.js";
import { normalize, recognize, transpose, PITCH_CLASS_NAMES } from "./theory.js";
import { buildReport, compareResults } from "./report.js";

const DATA_DIR = process.env.CHORD_DATA_DIR ?? join(process.cwd(), "data");

function parseNotes(arg: string | undefined, flag: string): number[] {
  if (arg === undefined) {
    throw new Error(`缺少参数 ${flag}，应为逗号分隔的 MIDI 整数，例如 "${flag} 60,64,67"`);
  }
  const notes: number[] = [];
  for (const part of arg.split(",")) {
    const trimmed = part.trim();
    if (trimmed === "") throw new Error(`${flag} 中存在空项`);
    notes.push(Number(trimmed));
  }
  return notes;
}

function printResult(notes: number[]): void {
  const result = recognize(notes);
  console.log(`输入音符   : ${JSON.stringify(notes)}`);
  console.log(`规范音级   : [${result.pitchClasses.join(", ")}] (${result.pitchClasses.map((p) => PITCH_CLASS_NAMES[p]).join(" ")})`);
  console.log(`低音       : ${result.bass} (${result.bassName})`);
  console.log(`状态       : ${result.status}`);
  if (result.candidates.length === 0) {
    console.log("候选       : 无匹配（音级集合不能与任何固定模板完全相等）");
    return;
  }
  result.candidates.forEach((c, i) => {
    console.log(
      `候选 ${i + 1}: ${c.rootName}(${c.root}) ${c.typeLabel} ` +
        `低音=${c.bassName} 低音音程=${c.bassIntervalFromRoot} ` +
        `${c.inversionLabel}(模板成分#${c.inversion})`,
    );
    for (const comp of c.components) {
      console.log(
        `    成分#${comp.componentIndex} 音级=${comp.pitchClass} ` +
          `音程=${comp.intervalFromRoot} 来源音符=${JSON.stringify(comp.sourceNotes)}`,
      );
    }
  });
}

function main(): void {
  const [command, ...rest] = process.argv.slice(2);
  const flags = new Map<string, string>();
  for (let i = 0; i < rest.length; i += 2) {
    const key = rest[i];
    const val = rest[i + 1];
    if (key !== undefined && val !== undefined && key.startsWith("--")) {
      flags.set(key.slice(2), val);
    }
  }

  switch (command) {
    case "recognize": {
      printResult(parseNotes(flags.get("notes"), "--notes"));
      break;
    }
    case "submit": {
      const store = new ChordStore(join(DATA_DIR, "chords.sqlite"));
      try {
        const saved = store.recognizeAndStore(parseNotes(flags.get("notes"), "--notes"));
        console.log(JSON.stringify({ id: saved.id, reused: saved.reused, status: saved.status, candidateCount: saved.candidates.length }, null, 2));
      } finally {
        store.close();
      }
      break;
    }
    case "normalize": {
      console.log(JSON.stringify(normalize(parseNotes(flags.get("notes"), "--notes")), null, 2));
      break;
    }
    case "transpose": {
      const notes = parseNotes(flags.get("notes"), "--notes");
      const semitones = Number(flags.get("semitones") ?? "");
      console.log(JSON.stringify(transpose(notes, semitones), null, 2));
      break;
    }
    case "compare": {
      const cmp = compareResults(
        recognize(parseNotes(flags.get("a"), "--a")),
        recognize(parseNotes(flags.get("b"), "--b")),
      );
      console.log(JSON.stringify(cmp, null, 2));
      break;
    }
    case "export": {
      const notes = parseNotes(flags.get("notes"), "--notes");
      console.log(JSON.stringify(buildReport(notes, recognize(notes)), null, 2));
      break;
    }
    case "list": {
      const store = new ChordStore(join(DATA_DIR, "chords.sqlite"));
      try {
        console.log(JSON.stringify(store.list().map((s) => ({ id: s.id, inputNotes: s.inputNotes, status: s.status })), null, 2));
      } finally {
        store.close();
      }
      break;
    }
    default:
      console.log([
        "用法: chord <command> [参数]",
        "命令:",
        "  recognize  --notes 60,64,67     识别并打印候选（不写库）",
        "  submit     --notes 60,64,67     提交并持久化完整候选（幂等）",
        "  normalize  --notes 60,72        预览规范音级集合与低音",
        "  transpose  --notes 60,64 --semitones 2   整体平移半音（超范围拒绝）",
        "  compare    --a 60,64,67 --b 64,67,72     比较两个配器",
        "  export     --notes 60,64,67     导出完整 JSON 报告",
        "  list                            列出已保存报告",
      ].join("\n"));
  }
}

try {
  main();
} catch (err) {
  if (err instanceof Error && "code" in err) {
    console.error(`错误[${(err as { code: string }).code}]: ${err.message}`);
  } else {
    console.error(`错误: ${err instanceof Error ? err.message : String(err)}`);
  }
  process.exitCode = 1;
}
