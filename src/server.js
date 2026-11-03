import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { gunzipSync } from 'node:zlib';
import { extractApiRequests } from './otlp.js';

const MAX_BODY_BYTES = 20 * 1024 * 1024;
const OTLP_PATHS = new Set(['/v1/logs', '/v1/metrics', '/v1/traces']);
const PUBLIC_DIR = new URL('../public/', import.meta.url);
const STATIC_FILES = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function send(res, status, contentType, body) {
  res.writeHead(status, {
    'Content-Type': contentType,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(body);
}

function sendJson(res, status, value) {
  send(res, status, 'application/json', JSON.stringify(value));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new HttpError(413, 'Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function decodeBody(req, body) {
  const encoding = req.headers['content-encoding'];
  if (!encoding || encoding === 'identity') return body;
  if (encoding === 'gzip') return gunzipSync(body, { maxOutputLength: MAX_BODY_BYTES * 5 });
  throw new HttpError(415, `Unsupported Content-Encoding: ${encoding}`);
}

async function receiveOtlp(req, res, pathname, store) {
  if (!req.headers['content-type']?.includes('application/json')) {
    throw new HttpError(415, 'Only OTLP JSON is supported. Set OTEL_EXPORTER_OTLP_PROTOCOL=http/json');
  }
  const body = decodeBody(req, await readBody(req));
  if (pathname === '/v1/logs') {
    let batch;
    try {
      batch = JSON.parse(body.toString('utf8'));
    } catch {
      throw new HttpError(400, 'Invalid JSON');
    }
    store.add(extractApiRequests(batch));
  }
  sendJson(res, 200, {});
}

function serveStatic(res, pathname) {
  const [file, contentType] = STATIC_FILES[pathname];
  send(res, 200, contentType, readFileSync(new URL(file, PUBLIC_DIR)));
}

export function createViewerServer({ store }) {
  const server = createServer(async (req, res) => {
    try {
      const port = server.address().port;
      if (req.headers.host !== `127.0.0.1:${port}` && req.headers.host !== `localhost:${port}`) {
        throw new HttpError(403, 'Forbidden host');
      }

      const { pathname } = new URL(req.url, 'http://localhost');

      if (req.method === 'POST' && OTLP_PATHS.has(pathname)) {
        await receiveOtlp(req, res, pathname, store);
      } else if (req.method === 'GET' && pathname === '/api/summary') {
        sendJson(res, 200, store.summary());
      } else if (req.method === 'POST' && pathname === '/api/compact') {
        if (req.headers['x-viewer-action'] !== 'compact') throw new HttpError(403, 'Missing x-viewer-action header');
        sendJson(res, 200, { compacted: store.compactAll() });
      } else if (req.method === 'GET' && Object.hasOwn(STATIC_FILES, pathname)) {
        serveStatic(res, pathname);
      } else {
        throw new HttpError(404, 'Not found');
      }
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      if (!res.headersSent) sendJson(res, status, { error: status === 500 ? 'Internal error' : error.message });
      if (status === 500) console.error(error);
    }
  });
  return server;
}
