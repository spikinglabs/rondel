// Minimal in-memory Nostr relay (NIP-01 subset) for local testing. Stores nothing.
import { WebSocketServer } from 'ws';

export function startRelay(port = 7447) {
  const wss = new WebSocketServer({ port });
  const subs = new Map(); // ws -> Map(subId -> filters[])
  const matches = (f, ev) =>
    (!f.kinds || f.kinds.includes(ev.kind)) &&
    Object.entries(f).every(([k, v]) => !k.startsWith('#') || ev.tags.some((t) => t[0] === k.slice(1) && v.includes(t[1])));
  wss.on('connection', (ws) => {
    subs.set(ws, new Map());
    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(String(raw)); } catch { return; }
      const [type, ...rest] = msg;
      if (type === 'EVENT') {
        const ev = rest[0];
        ws.send(JSON.stringify(['OK', ev.id, true, '']));
        for (const [client, s] of subs) for (const [subId, filters] of s) {
          if (filters.some((f) => matches(f, ev)) && client.readyState === 1) client.send(JSON.stringify(['EVENT', subId, ev]));
        }
      } else if (type === 'REQ') {
        const [subId, ...filters] = rest;
        subs.get(ws).set(subId, filters);
        ws.send(JSON.stringify(['EOSE', subId]));
      } else if (type === 'CLOSE') {
        subs.get(ws).delete(rest[0]);
      }
    });
    ws.on('close', () => subs.delete(ws));
  });
  return wss;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startRelay(Number(process.env.PORT ?? 7447));
  console.log('nostr test relay on', process.env.PORT ?? 7447);
}
