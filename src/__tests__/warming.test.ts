import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Distill } from '../index.js';
import { MemoryCache } from '../cache.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixtureHtml = fs.readFileSync(
  path.join(__dirname, '../../test/fixtures/ora-00001.html'),
  'utf-8'
);

function makeResponse(status: number, body = ''): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    text: () => Promise.resolve(body),
  } as unknown as Response;
}

describe('Cache warming', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('warm() with stale entries re-fetches only stale entries', async () => {
    vi.useFakeTimers();

    const cache = new MemoryCache();
    // Set 3 entries with a very short TTL so they will become stale
    await cache.set('ora-00001', { code: 'ora-00001' }, 1);
    await cache.set('ora-00002', { code: 'ora-00002' }, 1);
    await cache.set('ora-00003', { code: 'ora-00003' }, 1);

    // Advance time so all entries are stale
    vi.advanceTimersByTime(10);

    mockFetch.mockResolvedValue(makeResponse(200, fixtureHtml));

    const client = new Distill({ cache });
    await client.warm();

    expect(mockFetch).toHaveBeenCalledTimes(3);

    vi.useRealTimers();
  });

  it('warm({ codes }) fetches only specified codes', async () => {
    mockFetch.mockResolvedValue(makeResponse(200, fixtureHtml));

    const cache = new MemoryCache();
    const client = new Distill({ cache });

    await client.warm({ codes: ['ORA-00001'] });

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('warmAll() fetches index then all codes', async () => {
    const indexHtml = `
      <html><body>
        <a href="ora-00001/">ORA-00001</a>
        <a href="ora-00002/">ORA-00002</a>
        <a href="ora-00003/">ORA-00003</a>
      </body></html>
    `;

    mockFetch
      .mockResolvedValueOnce(makeResponse(200, indexHtml))
      .mockResolvedValue(makeResponse(200, fixtureHtml));

    const cache = new MemoryCache();
    const client = new Distill({ cache });

    await client.warmAll();

    // 1 index fetch + 3 code fetches
    expect(mockFetch).toHaveBeenCalledTimes(4);
  });

  it('warm() failure on one code does not affect others', async () => {
    mockFetch
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValue(makeResponse(200, fixtureHtml));

    const cache = new MemoryCache();
    const client = new Distill({ cache });

    // Should not throw even though one fetch fails
    await expect(
      client.warm({ codes: ['ORA-00001', 'ORA-00002', 'ORA-00003'] })
    ).resolves.toBeUndefined();

    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('warm() with cache disabled throws', async () => {
    const client = new Distill({ cache: false });

    await expect(client.warm()).rejects.toThrow('Cache is disabled — cannot warm');
  });

  it('warmAll() with cache disabled throws', async () => {
    const client = new Distill({ cache: false });

    await expect(client.warmAll()).rejects.toThrow('Cache is disabled — cannot warm');
  });

  it('warm() calls onProgress callback for each code', async () => {
    mockFetch.mockResolvedValue(makeResponse(200, fixtureHtml));

    const cache = new MemoryCache();
    const client = new Distill({ cache });
    const onProgress = vi.fn();

    await client.warm({ codes: ['ORA-00001', 'ORA-00002'], onProgress });

    expect(onProgress).toHaveBeenCalledTimes(2);
    // Both codes processed — progress should reach (2, 2)
    const calls = onProgress.mock.calls;
    // done values should include 1 and 2, total is always 2
    const doneCounts = calls.map(([done, _total]: [number, number]) => done).sort();
    const totals = calls.map(([_done, total]: [number, number]) => total);
    expect(doneCounts).toEqual([1, 2]);
    expect(totals).toEqual([2, 2]);
  });
});
