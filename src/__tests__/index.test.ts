import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Distill } from '../index.js';
import { MemoryCache } from '../cache.js';
import { ExtractionError } from '../errors.js';
import DistillDefault from '../index.js';

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

describe('Distill', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fetchError returns OracleError with expected fields', async () => {
    mockFetch.mockResolvedValueOnce(makeResponse(200, fixtureHtml));

    const client = new Distill({ cache: new MemoryCache() });
    const result = await client.fetchError('ORA-00001');

    expect(result).toBeTruthy();
    expect(typeof result.code).toBe('string');
    expect(result.code).toBeTruthy();
    expect(typeof result.message).toBe('string');
    expect(result.message).toBeTruthy();
    expect(typeof result.cause).toBe('string');
    expect(result.cause).toBeTruthy();
    expect(typeof result.action).toBe('string');
    expect(result.action).toBeTruthy();
    expect(typeof result.url).toBe('string');
    expect(result.url).toBeTruthy();
  });

  it('fetchErrors returns array with rate limiting — fetch called twice', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockFetch
      .mockResolvedValueOnce(makeResponse(200, fixtureHtml))
      .mockResolvedValueOnce(makeResponse(200, fixtureHtml));

    const client = new Distill({ cache: new MemoryCache() });
    const promise = client.fetchErrors(['ORA-00001', 'ORA-00002']);

    // advance the 100ms delay between calls
    await vi.advanceTimersByTimeAsync(200);

    const results = await promise;
    expect(results).toHaveLength(2);
    expect(mockFetch).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });

  it('cache hit skips fetch on second call', async () => {
    mockFetch.mockResolvedValueOnce(makeResponse(200, fixtureHtml));

    const client = new Distill({ cache: new MemoryCache() });

    // First call — populates cache
    await client.fetchError('ORA-00001');
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Reset mock
    mockFetch.mockReset();
    mockFetch.mockResolvedValueOnce(makeResponse(200, fixtureHtml));

    // Second call — should hit cache, not fetch
    await client.fetchError('ORA-00001');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('stale cache returns stale data and triggers background refresh', async () => {
    vi.useFakeTimers();
    mockFetch.mockResolvedValue(makeResponse(200, fixtureHtml));

    // Use cacheTtl: 1 so Distill stores entries with 1ms TTL
    const cache = new MemoryCache(1);
    const client = new Distill({ cache, cacheTtl: 1 });

    // First call — populates cache
    await client.fetchError('ORA-00001');
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Advance time past TTL to make entry stale
    vi.advanceTimersByTime(10);

    // Reset mock to track new calls
    mockFetch.mockClear();
    mockFetch.mockResolvedValue(makeResponse(200, fixtureHtml));

    // Second call — should return stale data immediately
    const result = await client.fetchError('ORA-00001');
    expect(result).toBeTruthy();
    expect(result.url).toBeTruthy();

    // Background refresh should have been triggered (fire-and-forget)
    // Flush the microtask queue so the background Promise chain can run
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // The background refresh should have fetched
    expect(mockFetch).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });

  it('cache miss triggers fetch', async () => {
    mockFetch.mockResolvedValueOnce(makeResponse(200, fixtureHtml));

    const client = new Distill({ cache: new MemoryCache() });
    await client.fetchError('ORA-00001');

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('noCache bypasses cache and fetches again', async () => {
    mockFetch.mockResolvedValueOnce(makeResponse(200, fixtureHtml));

    const client = new Distill({ cache: new MemoryCache() });

    // First call — populates cache
    await client.fetchError('ORA-00001');
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Reset mock and re-mock
    mockFetch.mockReset();
    mockFetch.mockResolvedValueOnce(makeResponse(200, fixtureHtml));

    // Second call with noCache — should fetch again
    await client.fetchError('ORA-00001', { noCache: true });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('extract with matched URL returns Record with extracted fields', async () => {
    mockFetch.mockResolvedValueOnce(makeResponse(200, fixtureHtml));

    const client = new Distill({ cache: false });
    const result = await client.extract(
      'https://docs.oracle.com/en/error-help/db/ora-00001/'
    );

    expect(result).toBeTruthy();
    expect(typeof result).toBe('object');
    expect(result).not.toBeNull();
    // Should have at least some extracted fields
    expect(Object.keys(result).length).toBeGreaterThan(0);
  });

  it('extract with unmatched URL throws ExtractionError', async () => {
    const client = new Distill({ cache: false });

    await expect(
      client.extract('https://unknown.com/page')
    ).rejects.toThrow(ExtractionError);
  });

  it('listErrors fetches index and returns ErrorIndex array', async () => {
    const indexHtml = `
      <html><body>
        <a href="ora-00001/">ORA-00001</a>
        <a href="ora-00002/">ORA-00002</a>
        <a href="ora-00003/">ORA-00003</a>
      </body></html>
    `;

    mockFetch.mockResolvedValueOnce(makeResponse(200, indexHtml));

    const client = new Distill({ cache: false });
    const results = await client.listErrors();

    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThan(0);

    for (const item of results) {
      expect(typeof item.code).toBe('string');
      expect(typeof item.url).toBe('string');
      expect(item.code).toBeTruthy();
      expect(item.url).toBeTruthy();
    }
  });

  it('constructor with cache disabled — fetchError works without caching', async () => {
    mockFetch.mockResolvedValueOnce(makeResponse(200, fixtureHtml));

    const client = new Distill({ cache: false });
    const result = await client.fetchError('ORA-00001');

    expect(result).toBeTruthy();
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Second call should fetch again since cache is disabled
    mockFetch.mockResolvedValueOnce(makeResponse(200, fixtureHtml));
    await client.fetchError('ORA-00001');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('default export is the Distill class', () => {
    expect(DistillDefault).toBe(Distill);
  });
});
