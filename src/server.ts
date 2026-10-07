import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { join } from "node:path";
import { ChordStore } from "./db.js";
import { ValidationError, NotFoundError, type ErrorCode } from "./errors.js";
import { normalize, recognize, transpose } from "./theory.js";
import { buildReport, compareResults } from "./report.js";

const PORT = Number(process.env.PORT ?? 0);
const DATA_DIR = process.env.CHORD_DATA_DIR ?? join(process.cwd(), "data");
const DB_PATH = join(DATA_DIR, "chords.sqlite");

const store = new ChordStore(DB_PATH);

interface JsonError {
  error: { code: ErrorCode; message: string };
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > 1_000_000) {
        reject(new ValidationError("BAD_REQUEST", "请求体过大"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (chunks.length === 0) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new ValidationError("INVALID_BODY", "请求体不是合法 JSON"));
      }
    });
    req.on("error", reject);
  });
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const path = url.pathname;
  const method = req.method ?? "GET";

  if (method === "GET" && path === "/health") {
    sendJson(res, 200, { ok: true, templateVersion: "pc-chord-templates-v1" });
    return;
  }

  if (method === "POST" && path === "/normalize") {
    const body = (await readBody(req)) as { notes?: unknown };
    sendJson(res, 200, normalize(body.notes));
    return;
  }

  if (method === "POST" && path === "/recognize") {
    const body = (await readBody(req)) as { notes?: unknown };
    // validateNotes 在 store 内部调用；非法输入在写库前抛出，不会保存
    const saved = store.recognizeAndStore(body.notes as number[]);
    sendJson(res, saved.reused ? 200 : 201, {
      id: saved.id,
      reused: saved.reused,
      createdAt: saved.createdAt,
      ...recognize(saved.inputNotes),
    });
    return;
  }

  if (method === "POST" && path === "/transpose") {
    const body = (await readBody(req)) as { notes?: unknown; semitones?: unknown };
    sendJson(res, 200, transpose(body.notes, body.semitones));
    return;
  }

  if (method === "POST" && path === "/compare") {
    const body = (await readBody(req)) as { a?: unknown; b?: unknown };
    if (!Array.isArray(body.a) || !Array.isArray(body.b)) {
      throw new ValidationError("INVALID_BODY", "需要提供 a 与 b 两个音符数组");
    }
    sendJson(res, 200, compareResults(recognize(body.a as number[]), recognize(body.b as number[])));
    return;
  }

  const exportMatch = path.match(/^\/arrangements\/([A-Za-z0-9]+)\/export$/);
  if (method === "GET" && exportMatch) {
    const saved = store.getById(exportMatch[1]!);
    if (!saved) throw new NotFoundError("NOT_FOUND", "报告不存在");
    const result = recognize(saved.inputNotes);
    sendJson(res, 200, buildReport(saved.inputNotes, result));
    return;
  }

  const itemMatch = path.match(/^\/arrangements\/([A-Za-z0-9]+)$/);
  if (method === "GET" && itemMatch) {
    const saved = store.getById(itemMatch[1]!);
    if (!saved) throw new NotFoundError("NOT_FOUND", "报告不存在");
    sendJson(res, 200, saved);
    return;
  }

  if (method === "GET" && path === "/arrangements") {
    sendJson(res, 200, { arrangements: store.list() });
    return;
  }

  sendJson(res, 404, { error: { code: "NOT_FOUND", message: `未知路径 ${method} ${path}` } } satisfies JsonError);
}

const server = createServer((req, res) => {
  handle(req, res).catch((err: unknown) => {
    if (err instanceof ValidationError) {
      sendJson(res, err.status, { error: { code: err.code, message: err.message } });
    } else if (err instanceof NotFoundError) {
      sendJson(res, err.status, { error: { code: err.code, message: err.message } });
    } else {
      sendJson(res, 500, {
        error: { code: "BAD_REQUEST", message: err instanceof Error ? err.message : "内部错误" },
      });
    }
  });
});

server.listen(PORT, () => {
  const address = server.address();
  const actualPort = typeof address === "object" && address ? address.port : PORT;
  console.log(JSON.stringify({
    service: "pitch-class-chord-backend",
    port: actualPort,
    dataDir: DATA_DIR,
    dbPath: DB_PATH,
  }));
});
