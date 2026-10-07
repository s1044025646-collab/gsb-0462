#!/usr/bin/env node
// 命令行：preview / recognize / submit / list / explain / compare / transpose / demo

import { join } from 'node:path';
import {
  TEMPLATE_VERSION,
  ValidationError,
  preview,
  recognize,
  transpose,
  validateNotes,
  type ChordCandidate,
  type RecognitionResult,
} from './music.js';
import { compareVoicings } from './compare.js';
import {
  exportReport,
  getSubmission,
  listSubmissions,
  openDatabase,
  saveSubmission,
} from './db.js';

function dataDir(): string {
  return process.env.CHORD_DATA_DIR ? process.env.CHORD_DATA_DIR : join(process.cwd(), 'data');
}

function parseNotes(arg: string): number[] {
  let raw: unknown;
  try {
    raw = JSON.parse(arg);
  } catch {
    raw = arg.split(',').map((s) => s.trim()).filter(Boolean).map(Number);
  }
  return validateNotes(raw);
}

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

function printCandidate(c: ChordCandidate, index: number): void {
  const comps = c.components
    .map((x) => `${x.role}=pc${x.pitchClass}[${x.sourceNotes.join('/')}]`)
    .join(' ');
  console.log(
    `  #${index} 根音=${c.rootName}(${c.rootPc}) ${c.typeLabel} ` +
    `低音=${c.bassName}(midi${c.bassMidi}) 低音音程=${c.bassIntervalFromRoot} ` +
    `${c.inversionLabel} | ${comps}`
  );
}

function statusZh(s: RecognitionResult['status']): string {
  return s === 'unique' ? '唯一候选' : s === 'ambiguous' ? '歧义多候选' : '无匹配';
}

function printRecognition(r: RecognitionResult): void {
  console.log(`模板版本: ${r.templateVersion}`);
  console.log(`输入(原始顺序): [${r.inputNotes.join(', ')}]`);
  console.log(`规范音级集合: ${r.pitchClassSetLabel}  最低音: midi${r.bassMidi}(pc${r.bassPc})`);
  console.log(`状态: ${statusZh(r.status)}（候选 ${r.candidates.length} 个）`);
  r.candidates.forEach((c, i) => printCandidate(c, i));
  if (r.candidates.length === 0) {
    console.log('  无匹配：该音级集合不能与任何固定模板完全相等。');
  }
}

function usage(): void {
  console.log(`用法:
  chord-cli preview "<midi数组>"            只预览规范音级 / 低音 / 成分来源
  chord-cli recognize "<midi数组>"          识别并打印全部候选（不落库）
  chord-cli submit "<midi数组>"             识别并保存（幂等），打印报告 id
  chord-cli list                            列出已保存报告
  chord-cli explain <id> [候选序号]         查看报告或某候选的成分来源
  chord-cli report <id>                     导出完整 JSON 报告
  chord-cli compare <idA> <idB>             比较两个配器
  chord-cli transpose "<midi数组>" <半音>    整体转调演示（不落库）
  chord-cli demo                            运行内置演示
示例:
  chord-cli recognize "[60,64,67]"
  chord-cli recognize 64,67,72
环境变量:
  CHORD_DATA_DIR  数据目录（默认 ./data）`);
}

function demo(): void {
  const cases: Array<[string, number[]]> = [
    ['C 大三根位', [60, 64, 67]],
    ['同一和弦第一转位', [64, 67, 72]],
    ['第二转位', [55, 60, 64]],
    ['增三（根音 0/4/8 歧义）', [60, 64, 68]],
    ['减七（四个根音歧义）', [60, 63, 66, 69]],
    ['重复八度不改变音级', [48, 60, 64, 67, 72]],
    ['最低音变化只影响转位', [67, 72, 76]],
    ['挂二 / 挂四双候选', [60, 62, 67]],
    ['加入额外音 -> 无匹配', [60, 64, 67, 68]],
    ['边界音高 0', [0, 4, 7]],
  ];
  for (const [title, notes] of cases) {
    console.log(`\n=== ${title}: [${notes.join(',')}] ===`);
    printRecognition(recognize(notes));
  }
  console.log('\n=== 输入重排不改变结果：[67,60,64] ===');
  printRecognition(recognize([67, 60, 64]));
  console.log('\n=== 非法小数 [60,64.5,67] 应拒绝 ===');
  try {
    recognize([60, 64.5, 67]);
  } catch (err) {
    if (err instanceof ValidationError) console.log(`已拒绝: ${err.code} - ${err.message}`);
  }
  console.log('\n=== 转调 +12 半音: [60,64,67] -> [72,76,79] ===');
  printRecognition(recognize(transpose([60, 64, 67], 12)));
  console.log('\n=== 转调越界拒绝: [120,124,127] +20 ===');
  try {
    transpose([120, 124, 127], 20);
  } catch (err) {
    if (err instanceof ValidationError) console.log(`已拒绝: ${err.code} - ${err.message}`);
  }
}

async function main(argv: string[]): Promise<number> {
  const [cmd, a, b] = argv;
  try {
    switch (cmd) {
      case 'preview': {
        if (!a) throw new ValidationError('EMPTY_INPUT', '缺少音符参数');
        printJson(preview(parseNotes(a)));
        return 0;
      }
      case 'recognize': {
        if (!a) throw new ValidationError('EMPTY_INPUT', '缺少音符参数');
        printRecognition(recognize(parseNotes(a)));
        return 0;
      }
      case 'submit': {
        if (!a) throw new ValidationError('EMPTY_INPUT', '缺少音符参数');
        const db = openDatabase(join(dataDir(), 'chords.db'));
        const saved = saveSubmission(db, recognize(parseNotes(a)));
        console.log(`报告 id=${saved.submission.id} ${saved.created ? '(新建)' : '(幂等命中)'}`);
        printRecognition(saved.submission.result);
        return 0;
      }
      case 'list': {
        const db = openDatabase(join(dataDir(), 'chords.db'));
        for (const s of listSubmissions(db)) {
          console.log(`#${s.id} [${s.created_at}] ${s.status} bass=${s.bass_midi} pcs=${s.pitch_classes}`);
        }
        return 0;
      }
      case 'explain': {
        if (!a) throw new ValidationError('EMPTY_INPUT', '缺少报告 id');
        const db = openDatabase(join(dataDir(), 'chords.db'));
        const stored = getSubmission(db, Number(a));
        if (!stored) { console.error('报告不存在'); return 1; }
        if (b === undefined) {
          printRecognition(stored.result);
        } else {
          const candidate = stored.result.candidates[Number(b)];
          if (!candidate) { console.error('候选序号不存在'); return 1; }
          printJson({ candidateIndex: Number(b), candidate });
        }
        return 0;
      }
      case 'report': {
        if (!a) throw new ValidationError('EMPTY_INPUT', '缺少报告 id');
        const db = openDatabase(join(dataDir(), 'chords.db'));
        const report = exportReport(db, Number(a));
        if (!report) { console.error('报告不存在'); return 1; }
        printJson(report);
        return 0;
      }
      case 'compare': {
        if (!a || !b) throw new ValidationError('EMPTY_INPUT', '需要两个报告 id');
        const db = openDatabase(join(dataDir(), 'chords.db'));
        const sa = getSubmission(db, Number(a));
        const sb = getSubmission(db, Number(b));
        if (!sa || !sb) { console.error('报告不存在'); return 1; }
        printJson(compareVoicings(sa.result, sb.result));
        return 0;
      }
      case 'transpose': {
        if (!a || b === undefined) throw new ValidationError('EMPTY_INPUT', '需要音符与半音数');
        printRecognition(recognize(transpose(parseNotes(a), Number(b))));
        return 0;
      }
      case 'demo':
        demo();
        return 0;
      default:
        usage();
        return cmd === undefined ? 0 : 1;
    }
  } catch (err) {
    if (err instanceof ValidationError) {
      console.error(`错误[${err.code}]: ${err.message}`);
      if (err.detail !== undefined) console.error('明细:', JSON.stringify(err.detail));
      return 2;
    }
    console.error(err);
    return 1;
  }
}

void TEMPLATE_VERSION;
main(process.argv.slice(2)).then((code) => process.exit(code));
