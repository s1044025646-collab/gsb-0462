// 比较两个配器（voicing）：同一音级集合可因八度排列 / 低音不同而转位不同。

import type { RecognitionResult } from './music.js';

export interface VoicingComparison {
  samePitchClassSet: boolean;
  pitchClassSetA: string;
  pitchClassSetB: string;
  sameBass: boolean;
  bassMidiA: number;
  bassMidiB: number;
  statusA: RecognitionResult['status'];
  statusB: RecognitionResult['status'];
  // 两边候选（根音,类型）集合是否一致，用于观察“匹配不受八度影响”
  sameCandidateKeys: boolean;
  candidateKeysA: string[];
  candidateKeysB: string[];
}

export function candidateKey(r: RecognitionResult): string[] {
  return r.candidates.map((c) => `${c.rootPc}:${c.type}`);
}

export function compareVoicings(a: RecognitionResult, b: RecognitionResult): VoicingComparison {
  const keysA = candidateKey(a);
  const keysB = candidateKey(b);
  return {
    samePitchClassSet: a.pitchClassSetLabel === b.pitchClassSetLabel,
    pitchClassSetA: a.pitchClassSetLabel,
    pitchClassSetB: b.pitchClassSetLabel,
    sameBass: a.bassMidi === b.bassMidi,
    bassMidiA: a.bassMidi,
    bassMidiB: b.bassMidi,
    statusA: a.status,
    statusB: b.status,
    sameCandidateKeys: JSON.stringify(keysA) === JSON.stringify(keysB),
    candidateKeysA: keysA,
    candidateKeysB: keysB,
  };
}
