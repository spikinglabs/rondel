// Rondel on any machine with Node 22+: serves the built app and stores meetings in one SQLite file.
//   node --import tsx server/node/server.ts      (or the compiled version)
// Settings: PORT (default 8787), DATA_DIR (default ./data), STATIC_DIR (default ./dist).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import { Room, ROOM_ID, type Conn } from '../core/room';
import { LIMITS, PROTOCOL_VERSION } from '../core/protocol';
import { openDatabase, SqliteStore } from './sqlite-store';
import { MemoryStore } from '../core/memory';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
};

export function createServer(opts: { staticDir?: string; dataDir?: string | null } = {}) {
  const staticDir = path.resolve(opts.staticDir ?? 'dist');
  const db = opts.dataDir === null ? null : (fs.mkdirSync(opts.dataDir ?? 'data', { recursive: true }), openDatabase(path.join(opts.dataDir ?? 'data', 'rondel.sqlite')));
  const rooms = new Map<string, Room>();
  const roomFor = (id: string) => {
    let r = rooms.get(id);
    if (!r) rooms.set(id, (r = new Room(db ? new SqliteStore(db, id) : new MemoryStore())));
    return r;
  };

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    if (url.pathname.endsWith('/api/health')) {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      return res.end(JSON.stringify({ rondel: true, protocol: PROTOCOL_VERSION }));
    }
    // Static files; unknown paths fall back to the app (it routes with #).
    let file = path.join(staticDir, decodeURIComponent(url.pathname));
    if (!file.startsWith(staticDir)) return void res.writeHead(400).end();
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(staticDir, 'index.html');
    if (!fs.existsSync(file)) return void res.writeHead(404).end('Build the app first: npm run build');
    const ext = path.extname(file);
    res.writeHead(200, {
      'content-type': TYPES[ext] ?? 'application/octet-stream',
      'cache-control': file.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache',
      'referrer-policy': 'no-referrer',
      'x-content-type-options': 'nosniff',
    });
    fs.createReadStream(file).pipe(res);
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: LIMITS.maxFrame });
  server.on('upgrade', (req, socket, head) => {
    const m = /\/api\/rooms\/([^/?]+)$/.exec(new URL(req.url ?? '/', 'http://x').pathname);
    if (!m || !ROOM_ID.test(m[1])) return socket.destroy();
    wss.handleUpgrade(req, socket, head, (ws: WebSocket) => {
      const room = roomFor(m[1]);
      const conn: Conn = { send: (t) => ws.send(t), close: (c, r) => ws.close(c, r) };
      room.open(conn);
      ws.on('message', (data, isBinary) => !isBinary && room.message(conn, data.toString()));
      ws.on('close', () => {
        room.close(conn);
        if (!room.size) rooms.delete(m[1]);
      });
      // Keep idle connections alive through proxies.
      const ping = setInterval(() => ws.ping(), 25_000);
      ping.unref();
      ws.on('close', () => clearInterval(ping));
    });
  });

  return { server, close: () => new Promise<void>((r) => { wss.clients.forEach((c) => c.terminate()); server.close(() => (db?.close(), r())); }) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT ?? 8787);
  const { server } = createServer({ staticDir: process.env.STATIC_DIR, dataDir: process.env.DATA_DIR });
  server.listen(port, () => console.log(`Rondel on http://localhost:${port}`));
}
