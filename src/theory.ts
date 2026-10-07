import { ValidationError } from "./errors.js";

export const TEMPLATE_VERSION = "pc-chord-templates-v1";

export interface ChordTemplate {
  /** 固定模板顺序中的索引，同时用于排序与转位序号 */
  index: number;
  type: string;
  label: string;
  /** 相对根音的半音音程，顺序即：根音 / 三音或挂留音 / 五音 / 七音 */
  intervals: number[];
}

export const TEMPLATES: readonly ChordTemplate[] = [
  { index: 0, type: "major", label: "大三和弦", intervals: [0, 4, 7] },
  { index: 1, type: "minor", label: "小三和弦", intervals: [0, 3, 7] },
  { index: 2, type: "diminished", label: "减三和弦", intervals: [0, 3, 6] },
  { index: 3, type: "augmented", label: "增三和弦", intervals: [0, 4, 8] },
  { index: 4, type: "sus2", label: "挂二", intervals: [0, 2, 7] },
  { index: 5, type: "sus4", label: "挂四", intervals: [0, 5, 7] },
  { index: 6, type: "dominant7", label: "属七", intervals: [0, 4, 7, 10] },
  { index: 7, type: "major7", label: "大七", intervals: [0, 4, 7, 11] },
  { index: 8, type: "minor7", label: "小七", intervals: [0, 3, 7, 10] },
  { index: 9, type: "half_diminished7", label: "半减七", intervals: [0, 3, 6, 10] },
  { index: 10, type: "diminished7", label: "减七", intervals: [0, 3, 6, 9] },
];

/** 统一升号显示标签，仅用于展示，匹配始终使用音级编号 */
export const PITCH_CLASS_NAMES: readonly string[] = [
  "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B",
];

export const MIN_MIDI = 0;
export const MAX_MIDI = 127;
export const MAX_NOTES = 64;

export function validateNotes(input: unknown): number[] {
  if (!Array.isArray(input)) {
    throw new ValidationError("INVALID_BODY", "notes 必须是整数数组");
  }
  if (input.length === 0) {
    throw new ValidationError("EMPTY_INPUT", "音符集合不能为空");
  }
  if (input.length > MAX_NOTES) {
    throw new ValidationError("TOO_MANY_NOTES", `音符数量不能超过 ${MAX_NOTES} 个`);
  }
  for (const note of input) {
    if (typeof note !== "number" || Number.isNaN(note)) {
      throw new ValidationError("INVALID_NOTE_TYPE", "每个音符必须是数字");
    }
    if (!Number.isFinite(note)) {
      throw new ValidationError("INVALID_NOTE_TYPE", "音符不能为 Infinity");
    }
    if (!Number.isInteger(note)) {
      throw new ValidationError("NON_INTEGER_NOTE", `音符 ${note} 必须是整数（不接受小数）`);
    }
    if (note < MIN_MIDI || note > MAX_MIDI) {
      throw new ValidationError("NOTE_OUT_OF_RANGE", `音符 ${note} 超出 MIDI 范围 0-127`);
    }
  }
  return input as number[];
}

export interface ComponentSource {
  /** 模板成分序号：0 根音、1 三音/挂留音、2 五音、3 七音 */
  componentIndex: number;
  /** 该成分的音级 */
  pitchClass: number;
  /** 相对根音的音程（半音） */
  intervalFromRoot: number;
  /** 实际输入中对应该音级的全部原始 MIDI 音符（保留重复与八度） */
  sourceNotes: number[];
}

export interface ChordCandidate {
  root: number;
  rootName: string;
  type: string;
  typeLabel: string;
  bass: number;
  bassName: string;
  bassIntervalFromRoot: number;
  /** 低音对应模板的第几个成分；0 为根位，1 第一转位，依次类推 */
  inversion: number;
  inversionLabel: string;
  components: ComponentSource[];
}

export type RecognitionStatus = "no_match" | "unique" | "ambiguous";

export interface RecognitionResult {
  status: RecognitionStatus;
  /** 规范音级集合（升序去重） */
  pitchClasses: number[];
  /** 原始低音 = 原始整数音高最小值 */
  bass: number;
  bassName: string;
  templateVersion: string;
  candidates: ChordCandidate[];
}

function inversionLabel(inversion: number): string {
  switch (inversion) {
    case 0: return "根位";
    case 1: return "第一转位";
    case 2: return "第二转位";
    case 3: return "第三转位";
    default: return `第 ${inversion} 转位`;
  }
}

export function recognize(rawNotes: number[]): RecognitionResult {
  const notes = validateNotes(rawNotes);

  const byClass = new Map<number, number[]>();
  for (const note of notes) {
    const pc = ((note % 12) + 12) % 12;
    const list = byClass.get(pc);
    if (list) list.push(note);
    else byClass.set(pc, [note]);
  }
  for (const list of byClass.values()) list.sort((a, b) => a - b);

  const pitchClasses = [...byClass.keys()].sort((a, b) => a - b);
  const classSet = new Set(pitchClasses);
  const bass = Math.min(...notes);
  const bassPc = ((bass % 12) + 12) % 12;

  const candidates: ChordCandidate[] = [];

  // 完全相等匹配：枚举根音 0..11，平移模板后与输入音级集合逐一比较。
  // 多余音或缺失音都不会匹配；根音按 0..11 升序，同根音按固定模板顺序。
  for (let root = 0; root < 12; root++) {
    for (const template of TEMPLATES) {
      const shifted = template.intervals.map((iv) => (root + iv) % 12);
      if (shifted.length !== pitchClasses.length) continue;
      if (!shifted.every((pc) => classSet.has(pc))) continue;

      const bassInterval = (bassPc - root + 12) % 12;
      const inversion = template.intervals.indexOf(bassInterval);
      // 低音音级必然属于该集合，因此一定能在模板中找到对应成分
      if (inversion < 0) continue;

      const components: ComponentSource[] = template.intervals.map((iv, idx) => {
        const pc = (root + iv) % 12;
        return {
          componentIndex: idx,
          pitchClass: pc,
          intervalFromRoot: iv,
          sourceNotes: byClass.get(pc) ?? [],
        };
      });

      candidates.push({
        root,
        rootName: PITCH_CLASS_NAMES[root]!,
        type: template.type,
        typeLabel: template.label,
        bass: bassPc,
        bassName: PITCH_CLASS_NAMES[bassPc]!,
        bassIntervalFromRoot: bassInterval,
        inversion,
        inversionLabel: inversionLabel(inversion),
        components,
      });
    }
  }

  let status: RecognitionStatus;
  if (candidates.length === 0) status = "no_match";
  else if (candidates.length === 1) status = "unique";
  else status = "ambiguous";

  return {
    status,
    pitchClasses,
    bass,
    bassName: PITCH_CLASS_NAMES[bassPc]!,
    templateVersion: TEMPLATE_VERSION,
    candidates,
  };
}

/** 规范化预览：只返回规范音级集合与低音，不产生候选 */
export function normalize(rawNotes: unknown): {
  notes: number[];
  pitchClasses: number[];
  pitchClassNames: string[];
  bass: number;
  bassName: string;
} {
  const notes = validateNotes(rawNotes);
  const classes = new Set(notes.map((n) => ((n % 12) + 12) % 12));
  const pitchClasses = [...classes].sort((a, b) => a - b);
  const bass = Math.min(...notes);
  return {
    notes: [...notes],
    pitchClasses,
    pitchClassNames: pitchClasses.map((pc) => PITCH_CLASS_NAMES[pc]!),
    bass,
    bassName: PITCH_CLASS_NAMES[((bass % 12) + 12) % 12]!,
  };
}

/** 转调：整体平移整数半音；任一结果超出 0-127 即拒绝，不静默截断 */
export function transpose(rawNotes: unknown, semitones: unknown): { notes: number[] } {
  const notes = validateNotes(rawNotes);
  if (typeof semitones !== "number" || !Number.isInteger(semitones)) {
    throw new ValidationError("NON_INTEGER_NOTE", "semitones 必须是整数");
  }
  const next = notes.map((n) => n + semitones);
  if (next.some((n) => n < MIN_MIDI || n > MAX_MIDI)) {
    throw new ValidationError(
      "MIDI_OUT_OF_RANGE_TRANSPOSE",
      `转调后出现超出 MIDI 范围 0-127 的音符，拒绝执行（不截断）`,
    );
  }
  return { notes: next };
}
