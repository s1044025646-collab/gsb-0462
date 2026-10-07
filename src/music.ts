// 十二平均律音级集合和弦识别核心：纯函数，不涉及 I/O。

export const TEMPLATE_VERSION = 'fixed-v1';

export interface ChordTemplate {
  type: string;
  label: string;
  // 模板顺序同时定义结构成分次序：0=根音，1=三音/挂留音，2=五音，3=七音
  intervals: number[];
}

// 固定模板顺序：候选排序也使用该顺序
export const TEMPLATES: readonly ChordTemplate[] = [
  { type: 'major',       label: '大三和弦', intervals: [0, 4, 7] },
  { type: 'minor',       label: '小三和弦', intervals: [0, 3, 7] },
  { type: 'diminished',  label: '减三和弦', intervals: [0, 3, 6] },
  { type: 'augmented',   label: '增三和弦', intervals: [0, 4, 8] },
  { type: 'sus2',        label: '挂二',     intervals: [0, 2, 7] },
  { type: 'sus4',        label: '挂四',     intervals: [0, 5, 7] },
  { type: 'dominant7',   label: '属七',     intervals: [0, 4, 7, 10] },
  { type: 'major7',      label: '大七',     intervals: [0, 4, 7, 11] },
  { type: 'minor7',      label: '小七',     intervals: [0, 3, 7, 10] },
  { type: 'halfDim7',    label: '半减七',   intervals: [0, 3, 6, 10] },
  { type: 'diminished7', label: '减七',     intervals: [0, 3, 6, 9] },
];

export const SHARP_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];

export const MIN_MIDI = 0;
export const MAX_MIDI = 127;
export const MAX_NOTES = 64;

export type ErrorCode =
  | 'NOT_AN_ARRAY'
  | 'EMPTY_INPUT'
  | 'TOO_MANY_NOTES'
  | 'NOTE_NOT_INTEGER'
  | 'NOTE_OUT_OF_RANGE'
  | 'SEMITONES_NOT_INTEGER'
  | 'TRANSPOSE_OUT_OF_RANGE';

export class ValidationError extends Error {
  readonly code: ErrorCode;
  readonly detail?: unknown;
  constructor(code: ErrorCode, message: string, detail?: unknown) {
    super(message);
    this.name = 'ValidationError';
    this.code = code;
    this.detail = detail;
  }
}

// 严格校验输入：必须是 1..64 个 0..127 的整数
export function validateNotes(input: unknown): number[] {
  if (!Array.isArray(input)) {
    throw new ValidationError('NOT_AN_ARRAY', '输入必须是 MIDI 整数音高数组');
  }
  if (input.length === 0) {
    throw new ValidationError('EMPTY_INPUT', '音符集合不能为空');
  }
  if (input.length > MAX_NOTES) {
    throw new ValidationError('TOO_MANY_NOTES', `音符数量不得超过 ${MAX_NOTES}`, { count: input.length });
  }
  for (const value of input) {
    if (typeof value !== 'number' || !Number.isInteger(value)) {
      throw new ValidationError('NOTE_NOT_INTEGER', '每个音符必须是整数（不接受小数或非数字）', { value });
    }
    if (value < MIN_MIDI || value > MAX_MIDI) {
      throw new ValidationError('NOTE_OUT_OF_RANGE', `音符必须在 ${MIN_MIDI}..${MAX_MIDI} 范围内`, { value });
    }
  }
  return input as number[];
}

export interface Normalized {
  // 输入顺序原样保留（含重复与八度）
  inputNotes: number[];
  // 升序去重音级
  pitchClasses: number[];
  // 每个音级对应实际输入音符（保留首次出现索引，稳定可核对）
  sourcesByPc: Record<number, number[]>;
  // 原始最小 MIDI 音高（低音）
  bassMidi: number;
  bassPitchClass: number;
}

export function normalize(input: unknown): Normalized {
  const notes = validateNotes(input);
  const sources = new Map<number, number[]>();
  let bassMidi = notes[0]!;
  notes.forEach((note, index) => {
    if (note < bassMidi) bassMidi = note;
    const pc = ((note % 12) + 12) % 12;
    const list = sources.get(pc);
    if (list) list.push(note);
    else sources.set(pc, [note]);
  });
  const pitchClasses = [...sources.keys()].sort((a, b) => a - b);
  const sourcesByPc: Record<number, number[]> = {};
  for (const pc of pitchClasses) sourcesByPc[pc] = sources.get(pc)!;
  return {
    inputNotes: [...notes],
    pitchClasses,
    sourcesByPc,
    bassMidi,
    bassPitchClass: ((bassMidi % 12) + 12) % 12,
  };
}

export interface ChordComponent {
  // 模板中的结构序号：0 根音，1 三音/挂留音，2 五音，3 七音
  position: number;
  role: string;
  intervalFromRoot: number;
  pitchClass: number;
  // 该成分对应的全部实际输入音符（含重复八度）
  sourceNotes: number[];
}

export interface ChordCandidate {
  rootPc: number;
  rootName: string;
  type: string;
  typeLabel: string;
  bassPc: number;
  bassMidi: number;
  bassName: string;
  // 低音相对根音的上行音程（0..11）
  bassIntervalFromRoot: number;
  // 低音落在模板的第几个成分：0=根位，1=第一转位，依次类推
  inversion: number;
  inversionLabel: string;
  components: ChordComponent[];
}

export type MatchStatus = 'none' | 'unique' | 'ambiguous';

export interface RecognitionResult {
  templateVersion: string;
  inputNotes: number[];
  pitchClasses: number[];
  pitchClassSetLabel: string;
  bassMidi: number;
  bassPc: number;
  status: MatchStatus;
  candidates: ChordCandidate[];
}

function roleLabel(type: string, position: number): string {
  if (position === 0) return '根音';
  if (position === 2) return '五音';
  if (position === 3) return '七音';
  return type === 'sus2' ? '挂留音(二度)' : type === 'sus4' ? '挂留音(四度)' : '三音';
}

function inversionLabel(inversion: number): string {
  return inversion === 0 ? '根位' : `第${inversion}转位`;
}

// 枚举 0..11 根音，与输入音级集合做“完全相等”比较
export function recognize(input: unknown): RecognitionResult {
  const norm = normalize(input);
  const inputSet = new Set(norm.pitchClasses);
  const candidates: ChordCandidate[] = [];

  TEMPLATES.forEach((template) => {
    for (let root = 0; root < 12; root++) {
      const shiftedPcs = template.intervals.map((iv) => (root + iv) % 12);
      const shiftedSet = new Set(shiftedPcs);
      // 完全相等：不能只包含，也不能有多余音
      if (shiftedSet.size !== inputSet.size) continue;
      let equal = true;
      for (const pc of inputSet) {
        if (!shiftedSet.has(pc)) { equal = false; break; }
      }
      if (!equal) continue;

      // 低音属于哪个模板成分（对称重复音级在模板内只出现一次）
      const bassInterval = (norm.bassPitchClass - root + 12) % 12;
      const inversion = template.intervals.indexOf(bassInterval);

      const components: ChordComponent[] = template.intervals.map((iv, position) => {
        const pc = (root + iv) % 12;
        return {
          position,
          role: roleLabel(template.type, position),
          intervalFromRoot: iv,
          pitchClass: pc,
          sourceNotes: norm.sourcesByPc[pc]!,
        };
      });

      candidates.push({
        rootPc: root,
        rootName: SHARP_NAMES[root]!,
        type: template.type,
        typeLabel: template.label,
        bassPc: norm.bassPitchClass,
        bassMidi: norm.bassMidi,
        bassName: SHARP_NAMES[norm.bassPitchClass]!,
        bassIntervalFromRoot: bassInterval,
        inversion,
        inversionLabel: inversionLabel(inversion),
        components,
      });
    }
  });

  // 稳定排序：先根音编号，再固定模板顺序（枚举已按该顺序生成，这里显式保证）
  const templateOrder = new Map(TEMPLATES.map((t, i) => [t.type, i]));
  candidates.sort((a, b) =>
    a.rootPc - b.rootPc ||
    (templateOrder.get(a.type)! - templateOrder.get(b.type)!)
  );

  const status: MatchStatus =
    candidates.length === 0 ? 'none' : candidates.length === 1 ? 'unique' : 'ambiguous';

  return {
    templateVersion: TEMPLATE_VERSION,
    inputNotes: norm.inputNotes,
    pitchClasses: norm.pitchClasses,
    pitchClassSetLabel: '{' + norm.pitchClasses.join(',') + '}',
    bassMidi: norm.bassMidi,
    bassPc: norm.bassPitchClass,
    status,
    candidates,
  };
}

// 转调演示：整体平移整数半音；超出 MIDI 范围直接拒绝，不截断
export function transpose(notes: number[], semitones: number): number[] {
  if (typeof semitones !== 'number' || !Number.isInteger(semitones)) {
    throw new ValidationError('SEMITONES_NOT_INTEGER', '半音数必须是整数', { value: semitones });
  }
  const base = validateNotes(notes);
  const next = base.map((n) => n + semitones);
  for (const n of next) {
    if (n < MIN_MIDI || n > MAX_MIDI) {
      throw new ValidationError(
        'TRANSPOSE_OUT_OF_RANGE',
        `转调后出现超出 ${MIN_MIDI}..${MAX_MIDI} 的音符，已拒绝`,
        { value: n }
      );
    }
  }
  return next;
}

// 只做规范化预览，不做识别
export function preview(input: unknown): {
  inputNotes: number[];
  pitchClasses: number[];
  pitchClassSetLabel: string;
  sourcesByPc: Record<number, number[]>;
  bassMidi: number;
} {
  const norm = normalize(input);
  return {
    inputNotes: norm.inputNotes,
    pitchClasses: norm.pitchClasses,
    pitchClassSetLabel: '{' + norm.pitchClasses.join(',') + '}',
    sourcesByPc: norm.sourcesByPc,
    bassMidi: norm.bassMidi,
  };
}
