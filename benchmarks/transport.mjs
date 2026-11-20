import { execFileSync } from 'node:child_process';
import { availableParallelism } from 'node:os';
import { Lane, encodeFrame, visitFrames } from '../telegram_webproxy.js';
import { FakeSocket, independentCTR, packet, syntheticGroup, transportFixture, until, windowFrame } from '../tests/fixtures.js';

const ORIGINAL = 'e565c57ff58656fd544755f67e1c266148c0b88f';
const compare = process.argv.find(arg => arg.startsWith('--against='));
let baseline = null;
let BaselineLane, mkSession;
if (compare !== undefined) {
  const revision = compare.slice('--against='.length);
  if (!revision) throw new Error('--against requires a Git revision');
  baseline = execFileSync('git', ['rev-parse', '--verify', '--end-of-options', revision + '^{commit}'], {
    encoding: 'utf8',
  }).trim();
  const upstream = execFileSync('git', ['show', baseline + ':telegram_webproxy.js'], { encoding: 'utf8' });
  const baselineSource = baseline === ORIGINAL ? upstream + '\nexport { mkSession };' : upstream;
  const uri = 'data:text/javascript;base64,' + Buffer.from(baselineSource).toString('base64');
  ({ Lane: BaselineLane, mkSession } = await import(uri));
  if (!BaselineLane && !mkSession) throw new Error('The reference must export Lane or mkSession');
}
const workloads = [
  ['交互小包', [[220, 60, 1]]],
  ['交互与媒体', [[160, 124, 1], [64, 65532, 8], [96, 8188, 12]]],
  ['连续大块', [[96, 131068, 8]]],
  ['512 KiB 媒体包', [[32, 524284, 2]]],
];

class Socket extends FakeSocket {
  sentBytes = 0;
  sends = 0;
  head;
  send(value) {
    if (this.readyState !== 1) throw Error('closed');
    if (this.sends++ === 0) this.head = Buffer.from(value);
    this.sentBytes += value.byteLength;
    this.onSend?.(value);
  }
}

function openFixture() {
  return new Promise(resolve => {
    const native = globalThis.WebSocket;
    globalThis.WebSocket = class extends Socket {
      protocol = 'binary';
      constructor() {
        super();
        queueMicrotask(() => {
          this.accept();
          this.dispatchEvent(new Event('open'));
          globalThis.WebSocket = native;
          resolve(this);
        });
      }
    };
  });
}

async function start(version, id, [count, size, burst]) {
  const fixture = transportFixture(0xdd, id);
  const client = new Socket();
  let peer, current;
  let credit = 0, downstream = 0, wake;
  client.onSend = data => {
    visitFrames(data, (type, sid, bytes, start, end) => {
      if (type === 4) credit += new DataView(bytes.buffer, bytes.byteOffset).getUint32(start);
      if (type === 2) {
        downstream += end - start;
        client.receive(encodeFrame(4, id, windowFrame(end - start)));
      }
    });
    wake?.();
  };
  let ready;
  if (version === 'upstream' && !BaselineLane) {
    ready = openFixture();
    mkSession({ secret: fixture.secret, sid: id }).attach(client);
  } else {
    peer = new Socket();
    const Relay = version === 'upstream' ? BaselineLane : Lane;
    current = new Relay(client, id, fixture.secret, syntheticGroup(), async () => peer);
    current.attach();
    ready = Promise.resolve(peer);
  }
  client.receive(encodeFrame(1, id));
  client.receive(encodeFrame(2, id, fixture.wire));
  peer = await ready;
  await until(() => peer.sends === 1 && credit === 64);
  const reverse = independentCTR(peer.head, null, true);
  const payload = packet(Buffer.alloc(size, 47));
  const batches = [];
  for (let i = 0; i < count; i += burst) {
    const batch = [];
    for (let pos = i; pos < Math.min(count, i + burst); pos++) {
      batch.push([encodeFrame(2, id, fixture.toWorker.update(payload)), reverse.update(payload)]);
    }
    batches.push(batch);
  }
  return {
    client, peer,
    async close() {
      client.close();
      if (current) await until(() => !current.upBusy && !current.downBusy);
    },
    async replay(latencies, probe) {
      let expected = 0;
      for (const batch of batches) {
        const time = performance.now();
        expected += batch.length * payload.length;
        await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('bench lane timed out')), 5000);
          wake = () => {
            if (downstream < expected || credit < expected + 64) return;
            wake = null;
            clearTimeout(timer);
            resolve();
          };
          for (const [up, down] of batch) {
            client.receive(up);
            peer.receive(down);
          }
        });
        latencies.push(performance.now() - time);
        probe();
      }
      if (credit !== expected + 64 || downstream !== expected) throw new Error('byte count mismatch');
      if (peer.sends !== count + 1) throw new Error('KWS frame boundary mismatch');
      return downstream * 2;
    },
  };
}

async function measure(version, spec) {
  const lanes = [];
  const samples = [];
  const cryptoStats = { calls: 0, output: 0 };
  const originalEncrypt = crypto.subtle.encrypt;
  const takeMemory = () => process.memoryUsage().arrayBuffers;
  let timer;
  try {
    for (const [n, lane] of spec.entries()) lanes.push(await start(version, n + 1, lane));
    globalThis.gc?.();
    const before = takeMemory();
    let peak = before;
    const probe = () => { peak = Math.max(peak, takeMemory()); };
    timer = setInterval(probe, 2);
    crypto.subtle.encrypt = async function (algorithm, key, input) {
      const result = await originalEncrypt.call(this, algorithm, key, input);
      cryptoStats.calls++;
      cryptoStats.output += result.byteLength;
      return result;
    };
    const startTime = performance.now();
    const startCPU = process.cpuUsage();
    const bytes = (await Promise.all(lanes.map(lane => lane.replay(samples, probe)))).reduce((a, b) => a + b);
    const elapsed = performance.now() - startTime;
    const cpu = process.cpuUsage(startCPU);
    probe();
    samples.sort((a, b) => a - b);
    const percentile = p => samples[Math.ceil(samples.length * p) - 1];
    return {
      MiBps: bytes / (1024 * 1024) / (elapsed / 1000),
      cpuMs: (cpu.user + cpu.system) / 1000, p50Ms: percentile(.50), p95Ms: percentile(.95),
      peakBuffersMiB: (peak - before) / (1024 * 1024), cryptoCalls: cryptoStats.calls,
      cryptoOutputMiB: cryptoStats.output / (1024 * 1024),
      kwsSends: lanes.reduce((n, lane) => n + lane.peer.sends - 1, 0),
      workerSends: lanes.reduce((n, lane) => n + lane.client.sends - 1, 0),
    };
  } finally {
    clearInterval(timer);
    crypto.subtle.encrypt = originalEncrypt;
    await Promise.all(lanes.map(lane => lane.close()));
  }
}

const rounds = process.argv.includes('--quick') ? 3 : 7;
const variants = baseline ? ['upstream', 'candidate'] : ['candidate'];
console.log(JSON.stringify({ node: process.version, platform: process.platform, cpus: availableParallelism(), rounds, baseline }));
for (const [name, spec] of workloads) {
  const results = Object.fromEntries(variants.map(variant => [variant, []]));
  for (const variant of variants) await measure(variant, spec);
  for (let i = 0; i < rounds; i++) {
    const order = i % 2 ? variants.toReversed() : variants;
    for (const variant of order) results[variant].push(await measure(variant, spec));
  }
  for (const [variant, rows] of Object.entries(results)) {
    const summary = Object.fromEntries(Object.keys(rows[0]).map(metric => {
      const values = rows.map(row => row[metric]).sort((a, b) => a - b);
      const round = n => Number(n.toFixed(3));
      return [metric, [round(values[(values.length - 1) / 2]), round(values[0]), round(values.at(-1))]];
    }));
    console.log(JSON.stringify({ name, variant, medianMinMax: summary }));
  }
}
