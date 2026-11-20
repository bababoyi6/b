import { runInNewContext } from 'node:vm';
import { afterEach, expect, it, vi } from 'vitest';
import worker, { encodeFrame } from '../telegram_webproxy.js';
import { ENV, HELLO, ORIGIN, VECTOR, FakeSocket, until } from './fixtures.js';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it.each([
  ['fresh inline ticket', 0, 0],
  ['stale inline ticket', 82000, 1],
])('executes the Bridge with a %s and isolates an established lane close', async (_, initialDelay, creates) => {
  const start = Date.now();
  const clock = vi.spyOn(Date, 'now').mockReturnValue(start);
  const response = await worker.fetch(new Request(ORIGIN + '/?bridge=' + VECTOR), ENV);
  const html = await response.text();
  const script = /<script nonce="[^"]+">([\s\S]*?)<\/script>/.exec(html)?.[1];
  expect(script).toBeTruthy();
  const calls = [], sockets = [], messages = [], listeners = new Map();
  let elapsed = initialDelay;
  clock.mockReturnValue(start + elapsed);
  class BrowserSocket extends FakeSocket {
    static OPEN = 1;
    constructor(url, protocol) {
      super();
      this.url = url;
      this.protocol = protocol;
      sockets.push(this);
      queueMicrotask(() => { this.accept(); this.onopen?.(); });
    }
    close(code = 1000) {
      super.close(code);
      this.onclose?.({ code });
    }
  }
  const injected = { postMessage(data) { messages.push(data); } };
  const parent = {};
  runInNewContext(script, {
    ArrayBuffer, Uint8Array, DataView, URL, AbortController, setTimeout, clearTimeout, parent,
    TelegramWebProxy: injected,
    location: { hash: '#android=' + 'A'.repeat(43), pathname: '/' },
    history: { replaceState: vi.fn() },
    addEventListener(name, listener) { listeners.set(name, listener); },
    WebSocket: BrowserSocket,
    performance: { now: () => elapsed },
    async fetch(url, options) {
      calls.push([url, options]);
      return worker.fetch(new Request(url, options), ENV);
    },
  });
  expect(JSON.parse(messages[0])).toEqual({ t: 'tproxy-android-init', v: 1, nonce: 'A'.repeat(43) });
  injected.onmessage({ data: HELLO.buffer });
  await until(() => messages.some(value => value instanceof ArrayBuffer && new Uint8Array(value)[0] === 17));
  try {
    expect(calls.filter(([url]) => url.endsWith('/api/v1/session'))).toHaveLength(creates);
    injected.onmessage({ data: encodeFrame(1, 1).buffer });
    await until(() => sockets[0]?.sent.length > 0);
    const first = encodeFrame(2, 1, Uint8Array.of(4, 5));
    const second = encodeFrame(2, 1, Uint8Array.of(6));
    const batch = new Uint8Array(first.length + second.length);
    batch.set(first);
    batch.set(second, first.length);
    const delivered = messages.length;
    sockets[0].onmessage({ data: batch.buffer });
    expect(messages.slice(delivered).filter(value => value instanceof ArrayBuffer)
      .map(value => [...new Uint8Array(value)])).toEqual([[...first], [...second]]);
    sockets[0].onmessage({ data: first.buffer });
    const traffic = () => messages.filter(value => typeof value === 'string')
      .map(value => JSON.parse(value)).filter(value => value.t === 'traffic');
    await until(() => traffic().length);
    expect(traffic()).toEqual([{ t: 'traffic', up: 8, down: batch.byteLength + first.byteLength }]);
    const original = sockets[0].protocol;
    elapsed = 301000;
    clock.mockReturnValue(start + elapsed);
    injected.onmessage({ data: encodeFrame(1, 2).buffer });
    injected.onmessage({ data: encodeFrame(1, 3).buffer });
    await until(() => sockets[2]?.sent.length > 0);
    expect(calls.filter(([url]) => url.endsWith('/renew'))).toHaveLength(1);
    expect(sockets[0].readyState).toBe(1);
    expect(sockets[1].protocol.split('.')[1]).not.toBe(original.split('.')[1]);
    expect(sockets[1].protocol.split('.')[1]).toBe(sockets[2].protocol.split('.')[1]);
    sockets[0].close();
    expect(messages.some(value => value instanceof ArrayBuffer && new DataView(value).getUint32(0) === 0x03000001)).toBe(true);
    expect(sockets[1].readyState).toBe(1);
    sockets[1].close(4001);
    sockets[2].onclose({ code: 4001 });
    expect(messages.filter(value => typeof value === 'string' && JSON.parse(value).t === 'close')).toHaveLength(1);
    expect(calls.filter(([, options]) => options.method === 'DELETE')).toHaveLength(0);
    expect(sockets[2].readyState).toBe(3);
  } finally {
    listeners.get('pagehide')();
  }
  expect(sockets.every(socket => socket.readyState === 3)).toBe(true);
  expect(injected.onmessage).toBeNull();
});

it.each([404, 503])('classifies a Session HTTP %s and cancels the pending retry on pagehide', async status => {
  const response = await worker.fetch(new Request(ORIGIN + '/?bridge=' + VECTOR), ENV);
  const script = /<script nonce="[^"]+">([\s\S]*?)<\/script>/.exec(await response.text())[1];
  vi.useFakeTimers();
  const start = Date.now();
  const messages = [], listeners = new Map();
  const injected = { postMessage(data) { messages.push(data); } };
  const post = vi.fn(async () => new Response(null, { status, headers: { 'Retry-After': '1' } }));
  runInNewContext(script, {
    ArrayBuffer, Uint8Array, DataView, URL, AbortController, setTimeout, clearTimeout, parent: {},
    TelegramWebProxy: injected,
    location: { hash: '#android=' + 'A'.repeat(43), pathname: '/' },
    history: { replaceState() {} },
    addEventListener(name, listener) { listeners.set(name, listener); },
    Math: Object.assign(Object.create(Math), { random: () => 0 }),
    performance: { now: () => Date.now() - start + 82000 },
    fetch: post,
  });
  injected.onmessage({ data: HELLO.buffer });
  await vi.advanceTimersByTimeAsync(999);
  expect(post).toHaveBeenCalledTimes(1);
  if (status === 404) {
    expect(messages.map(JSON.parse)).toContainEqual({ t: 'close' });
  } else {
    await vi.advanceTimersByTimeAsync(1);
    expect(post).toHaveBeenCalledTimes(2);
  }
  listeners.get('pagehide')();
  await vi.advanceTimersByTimeAsync(30000);
  expect(post).toHaveBeenCalledTimes(status === 404 ? 1 : 2);
  expect(injected.onmessage).toBeNull();
});
