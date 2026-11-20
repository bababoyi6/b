import assert from 'node:assert/strict';
import { createHmac, hkdfSync, pbkdf2Sync, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { encodeFrame, makeHead, visitFrames } from '../telegram_webproxy.js';
import { independentCTR, packet } from '../tests/fixtures.js';

const [passwordFile, ...options] = process.argv.slice(2);
const includeMedia = options.includes('--media');
const paired = options.includes('--paired');
const targets = options.filter(arg => arg !== '--media' && arg !== '--paired');
if (!passwordFile || !targets.length || (paired && targets.length !== 2)) {
  throw new Error('Usage: node experiments/probe-pages.mjs <test-password-file> [--media] [--paired] <https-url> [...]');
}
const password = readFileSync(passwordFile, 'utf8').trimEnd();
assert.ok(password.length >= 16);

function proxySecret(host) {
  const seed = pbkdf2Sync(password, 'cf-tgproxy-dashboard-v1\0' + host, 16000, 32, 'sha256');
  return Buffer.from(hkdfSync('sha256', seed, 'cf-tgproxy-portal-v1', 'telegram-proxy\0' + host, 16));
}

async function checkAdmin(origin, secret) {
  const response = await fetch(origin + '/admin', {
    method: 'POST', headers: { Origin: origin }, redirect: 'manual',
    body: new URLSearchParams({ password }), signal: AbortSignal.timeout(12000),
  });
  assert.equal(response.status, 303, 'admin login failed');
  const cookie = response.headers.get('Set-Cookie').split(';')[0];
  const admin = await fetch(origin + '/admin', { headers: { Cookie: cookie }, signal: AbortSignal.timeout(12000) });
  assert.equal(admin.status, 200);
  assert.ok((await admin.text()).includes('&amp;secret=' + secret.toString('hex')), 'password-only link mismatch');
}

function makeRequest() {
  const nonce = randomBytes(16);
  const request = Buffer.alloc(40);
  const messageId = (BigInt(Date.now()) * (1n << 32n) / 1000n) & ~3n;
  request.writeBigUInt64LE(messageId, 8);
  request.writeUInt32LE(20, 16);
  request.writeUInt32LE(0xbe7e8ef1, 20); // req_pq_multi
  nonce.copy(request, 24);
  return { nonce, request: packet(request, 0xee) };
}

async function probe({ origin, challenge, secret }, dc, media) {
  const started = performance.now();
  const time = () => Math.round(performance.now() - started);
  const get = await fetch(origin + '/?bridge=' + challenge, { signal: AbortSignal.timeout(10000) });
  if (get.status !== 200) {
    await get.body?.cancel();
    throw new Error('bridge-' + get.status);
  }
  const ticket = /"ticket":"([A-Za-z0-9_-]{43})"/.exec(await get.text())?.[1];
  if (!ticket) throw new Error('ticket');
  const bridge = time();
  const head = makeHead({ dc, mode: 0xee, media });
  const cipher = independentCTR(head, secret);
  const reverse = independentCTR(head, secret, true);
  const { nonce, request } = makeRequest();
  const wire = cipher.update(head);
  wire.set(head.subarray(0, 56));
  const frames = Buffer.concat([encodeFrame(1, 1), encodeFrame(2, 1, Buffer.concat([wire, cipher.update(request)]))]);
  const protocol = 'tproxy-lane-v1.' + ticket + '.1';
  const socket = new WebSocket(origin.replace('https:', 'wss:') + '/api/v1/ws', protocol);
  socket.binaryType = 'arraybuffer';
  let upgrade, first, response = Buffer.alloc(0), timer;
  try {
    return await new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('socket-timeout')), 12000);
      socket.addEventListener('open', () => {
        if (socket.protocol !== protocol) { reject(new Error('subprotocol')); return; }
        upgrade = time();
        socket.send(frames);
      });
      socket.addEventListener('message', ({ data }) => {
        try {
          visitFrames(data, (type, sid, bytes, offset, end) => {
            if (sid !== 1 || type === 3) throw new Error('lane-closed');
            if (type !== 2) return;
            first ??= time();
            response = Buffer.concat([response, reverse.update(bytes.subarray(offset, end))]);
            if (response.length > 4096) throw new Error('oversized-response');
          });
          if (response.length < 4) return;
          const size = response.readUInt32LE();
          if (size < 40 || size > 4092) throw new Error('transport-error');
          if (response.length < 4 + size) return;
          if (response.readBigUInt64LE(4) !== 0n || response.readUInt32LE(24) !== 0x05162463 ||
              !response.subarray(28, 44).equals(nonce)) throw new Error('invalid-resPQ');
          resolve({ bridge, upgrade, first, resPQ: time() });
        } catch (error) { reject(error); }
      });
      socket.addEventListener('error', () => reject(new Error('socket-error')), { once: true });
      socket.addEventListener('close', () => reject(new Error('socket-closed')), { once: true });
    });
  } finally {
    clearTimeout(timer);
    socket.close();
  }
}

const deployments = [];
for (const target of targets) {
  const url = new URL(target);
  assert.equal(url.protocol, 'https:');
  assert.ok(/\.(?:pages|workers)\.dev$/.test(url.hostname) && url.pathname === '/' && !url.search && !url.hash);
  const secret = proxySecret(url.hostname);
  const challenge = createHmac('sha256', secret).update('tdesktop-web-proxy-bridge-v1\n' + url.hostname).digest('base64url');
  await checkAdmin(url.origin, secret);
  deployments.push({ origin: url.origin, challenge, secret });
}

const results = new Map(deployments.map(({ origin }) => [origin, []]));
for (let round = 0; round < 3; round++) {
  const order = round % 2 ? [...deployments].reverse() : deployments;
  for (let dc = 1; dc <= 5; dc++) {
    for (const media of includeMedia ? [false, true] : [false]) {
      const record = async deployment => {
        let sample;
        try { sample = { dc, media, ...await probe(deployment, dc, media) }; }
        catch (error) { sample = { dc, media, failure: error.message }; }
        results.get(deployment.origin).push(sample);
      };
      if (paired) await Promise.all(order.map(record));
      else for (const deployment of order) await record(deployment);
    }
  }
}
for (const [origin, samples] of results) console.log(JSON.stringify({ origin, samples }));
