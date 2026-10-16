// Checks that a deployed Rondel answers: the app page loads, api/health answers, and a meeting room
// accepts a connection and a stored update. Exits non-zero on failure (used by the scheduled GitHub workflow).
//   node scripts/uptime.mjs https://rondel.lab.spikinglabs.com/
const base = new URL(process.argv[2] ?? 'https://rondel.lab.spikinglabs.com/');
const fail = (msg) => { console.error(`DOWN: ${msg}`); process.exit(1); };

const page = await fetch(base).catch((e) => fail(`app page: ${e.message}`));
if (!page.ok || !(await page.text()).includes('RONDEL_CONFIG')) fail(`app page: HTTP ${page.status}`);
const health = await fetch(new URL('api/health', base)).then((r) => r.json()).catch((e) => fail(`api/health: ${e.message}`));
if (!health?.rondel) fail('api/health did not answer as Rondel');

// A throwaway room: the update is random bytes, like any encrypted entry.
const room = `uptime${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const ws = new WebSocket(new URL(`api/rooms/${room}`, base).href.replace(/^http/, 'ws'));
const timer = setTimeout(() => fail('meeting room: no answer within 15 s'), 15_000);
ws.onerror = () => fail('meeting room: connection failed');
ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', v: health.protocol, auth: crypto.randomUUID(), since: 0 }));
ws.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  if (msg.t === 'error') fail(`meeting room: ${msg.message}`);
  if (msg.t === 'welcome') ws.send(JSON.stringify({ t: 'upd', id: 1, data: Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64') }));
  if (msg.t === 'ack') {
    clearTimeout(timer);
    console.log(`UP: ${base.href} (app, api/health, meeting room)`);
    ws.close();
    process.exit(0);
  }
};
