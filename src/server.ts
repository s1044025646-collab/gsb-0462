// HTTP API：仅后端 JSON 接口。

import { createServer, type IncomingMessage, type Server } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { join } from 'node:path';
import { ValidationError, preview, recognize, transpose } from './music.js';
import { compareVoicings } from './compare.js';
import {
  exportReport,
  getSubmission,
  listSubmissions,
  openDatabase,
  saveSubmission,
} from './db.js';

export interface AppConfig {
  dataDir: string;
  port: number | null; // null = 自动选择空闲端口
}

export function resolveConfig(): AppConfig {
  const dataDir = process.env.CHORD_DATA_DIR
    ? process.env.CHORD_DATA_DIR
    : join(process.cwd(), 'data');
  const portEnv = process.env.PORT ?? process.env.CHORD_PORT;
  if (portEnv !== undefined) {
    const port = Number(portEnv);
    if (!Number.isInteger(port) || port < 0 || port > 65535) {
      throw new Error(`非法端口配置: ${portEnv}`);
    }
    return { dataDir, port };
  }
  return { dataDir, port: null };
}

export function chooseFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createNetServer();
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      if (addr && typeof addr === 'object') {
        const port = addr.port;
        srv.close(() => resolve(port));
      } else {
        srv.close(() => reject(new Error('无法获取空闲端口')));
      }
    });
    srv.on('error', reject);
  });
}

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > 1_000_000) {
        reject(new ValidationError('NOT_AN_ARRAY', '请求体过大'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve(null);
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(Object.assign(new Error('非法 JSON'), { code: 'INVALID_JSON' }));
      }
    });
    req.on('error', reject);
  });
}

interface ApiResponse {
  status: number;
  body: unknown;
}

export function createApp(db: ReturnType<typeof openDatabase>) {
  async function handle(method: string, url: URL, req: IncomingMessage): Promise<ApiResponse> {
    const path = url.pathname;

    if (method === 'GET' && path === '/health') {
      return { status: 200, body: { ok: true, service: 'twelve-tone-chord-backend' } };
    }

    // 预览规范音级（不保存）
    if (method === 'POST' && path === '/preview') {
      const body = await readJson(req);
      const notes = (body as { notes?: unknown } | null)?.notes;
      return { status: 200, body: { preview: preview(notes) } };
    }

    // 识别（不保存）
    if (method === 'POST' && path === '/recognize') {
      const body = await readJson(req);
      const notes = (body as { notes?: unknown } | null)?.notes;
      return { status: 200, body: recognize(notes) };
    }

    // 提交并持久化（幂等：重复八度 / 重排命中同一记录）
    if (method === 'POST' && path === '/submissions') {
      const body = await readJson(req);
      const notes = (body as { notes?: unknown } | null)?.notes;
      const result = recognize(notes);
      const saved = saveSubmission(db, result);
      return {
        status: saved.created ? 201 : 200,
        body: {
          id: saved.submission.id,
          idempotent: !saved.created,
          recognition: saved.submission.result,
        },
      };
    }

    if (method === 'GET' && path === '/submissions') {
      return { status: 200, body: { submissions: listSubmissions(db).map((s) => ({
        id: s.id,
        createdAt: s.created_at,
        status: s.status,
        bassMidi: s.bass_midi,
        pitchClasses: JSON.parse(s.pitch_classes) as number[],
        recognition: s.result,
      })) } };
    }

    const idMatch = path.match(/^\/submissions\/(\d+)$/);
    if (method === 'GET' && idMatch) {
      const stored = getSubmission(db, Number(idMatch[1]));
      if (!stored) return { status: 404, body: { error: { code: 'NOT_FOUND', message: '报告不存在' } } };
      return { status: 200, body: { id: stored.id, createdAt: stored.created_at, recognition: stored.result } };
    }

    // 解释某个已保存候选：按候选序号返回成分来源
    const explainMatch = path.match(/^\/submissions\/(\d+)\/candidates\/(\d+)$/);
    if (method === 'GET' && explainMatch) {
      const stored = getSubmission(db, Number(explainMatch[1]));
      if (!stored) return { status: 404, body: { error: { code: 'NOT_FOUND', message: '报告不存在' } } };
      const idx = Number(explainMatch[2]);
      const candidate = stored.result.candidates[idx];
      if (!candidate) return { status: 404, body: { error: { code: 'CANDIDATE_NOT_FOUND', message: '候选序号不存在' } } };
      return { status: 200, body: { candidateIndex: idx, candidate } };
    }

    // 导出报告
    const reportMatch = path.match(/^\/submissions\/(\d+)\/report$/);
    if (method === 'GET' && reportMatch) {
      const report = exportReport(db, Number(reportMatch[1]));
      if (!report) return { status: 404, body: { error: { code: 'NOT_FOUND', message: '报告不存在' } } };
      return { status: 200, body: report };
    }

    // 比较两个已保存配器
    if (method === 'POST' && path === '/compare') {
      const body = (await readJson(req)) as { aId?: number; bId?: number } | null;
      const a = getSubmission(db, Number(body?.aId));
      const b = getSubmission(db, Number(body?.bId));
      if (!a || !b) {
        return { status: 404, body: { error: { code: 'NOT_FOUND', message: '待比较的报告不存在' } } };
      }
      return { status: 200, body: { aId: a.id, bId: b.id, comparison: compareVoicings(a.result, b.result) } };
    }

    // 转调演示：识别新输入（默认不覆盖原报告；保存需显式 persist=true）
    if (method === 'POST' && path === '/transpose') {
      const body = (await readJson(req)) as { notes?: unknown; semitones?: number; persist?: boolean } | null;
      const moved = transpose(body?.notes as number[], Number(body?.semitones));
      const result = recognize(moved);
      let saved: { id: number; idempotent: boolean } | null = null;
      if (body?.persist === true) {
        const s = saveSubmission(db, result);
        saved = { id: s.submission.id, idempotent: !s.created };
      }
      return { status: 200, body: { transposedNotes: moved, recognition: result, persisted: saved } };
    }

    return { status: 404, body: { error: { code: 'ROUTE_NOT_FOUND', message: '未知接口' } } };
  }

  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    try {
      const { status, body } = await handle(req.method ?? 'GET', url, req);
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(body));
    } catch (err) {
      if (err instanceof ValidationError) {
        res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: { code: err.code, message: err.message, detail: err.detail ?? null } }));
        return;
      }
      const code = (err as { code?: string }).code;
      if (code === 'INVALID_JSON') {
        res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: { code: 'INVALID_JSON', message: '请求体不是合法 JSON' } }));
        return;
      }
      res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: { code: 'INTERNAL', message: (err as Error).message } }));
    }
  });

  return server;
}

async function main() {
  const config = resolveConfig();
  const db = openDatabase(join(config.dataDir, 'chords.db'));
  const server = createApp(db);
  const port = config.port ?? (await chooseFreePort());
  server.listen(port, '127.0.0.1', () => {
    console.log(`和弦识别后端已启动: http://127.0.0.1:${port}`);
    console.log(`数据目录: ${config.dataDir}`);
  });
}

// 仅作为入口模块直接运行时启动（被测试 import 时不启动）
if (process.argv[1] && import.meta.url === new URL(`file:///${process.argv[1].replace(/\\/g, '/')}`).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
