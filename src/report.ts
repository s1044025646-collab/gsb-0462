import type { ChordCandidate, RecognitionResult } from "./theory.js";

export interface CompareResult {
  samePitchClasses: boolean;
  sameBass: boolean;
  sameChordStructure: boolean;
  pitchClassesOnly: boolean;
  a: { pitchClasses: number[]; bass: number; status: string };
  b: { pitchClasses: number[]; bass: number; status: string };
}

function sameSet(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}

/** 比较两份识别结果：音级集合、低音、以及（根音, 类型）结构候选集合是否一致 */
export function compareResults(a: RecognitionResult, b: RecognitionResult): CompareResult {
  const keyOf = (c: ChordCandidate) => `${c.root}:${c.type}`;
  const keysA = new Set(a.candidates.map(keyOf));
  const keysB = new Set(b.candidates.map(keyOf));
  const sameChordStructure =
    keysA.size === keysB.size && [...keysA].every((k) => keysB.has(k));
  return {
    samePitchClasses: sameSet(a.pitchClasses, b.pitchClasses),
    sameBass: a.bass === b.bass,
    sameChordStructure,
    pitchClassesOnly: sameSet(a.pitchClasses, b.pitchClasses) && a.bass !== b.bass,
    a: { pitchClasses: a.pitchClasses, bass: a.bass, status: a.status },
    b: { pitchClasses: b.pitchClasses, bass: b.bass, status: b.status },
  };
}

export interface ExportableReport {
  generatedAt: string;
  inputNotes: number[];
  pitchClasses: number[];
  bass: number;
  templateVersion: string;
  status: RecognitionResult["status"];
  candidateCount: number;
  candidates: RecognitionResult["candidates"];
}

export function buildReport(inputNotes: number[], result: RecognitionResult): ExportableReport {
  return {
    generatedAt: new Date().toISOString(),
    inputNotes,
    pitchClasses: result.pitchClasses,
    bass: result.bass,
    templateVersion: result.templateVersion,
    status: result.status,
    candidateCount: result.candidates.length,
    candidates: result.candidates,
  };
}
