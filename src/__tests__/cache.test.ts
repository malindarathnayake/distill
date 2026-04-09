import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { FilesystemCache, MemoryCache } from '../cache.js';

function makeTmpDir(): string {
  return path.join(os.tmpdir(), `distill-cache-test-${Math.random().toString(36).slice(2)}`);
}

describe('FilesystemCache', () => {
  let tmpDir: string;
  let cache: FilesystemCache;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    cache = new FilesystemCache(tmpDir);
  });

  afterEach(() => {
    vi.useRealTimers();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('set → get roundtrip', async () => {
    await cache.set('mykey', { hello: 'world' });
    const result = await cache.get<{ hello: string }>('mykey');
    expect(result).toEqual({ hello: 'world' });
  });

  it('gzip compression — file starts with gzip magic bytes and decompresses to valid JSON', async () => {
    await cache.set('compressed', { value: 42 });

    const filePath = path.join(tmpDir, 'compressed.json.gz');
    const raw = fs.readFileSync(filePath);

    // Check gzip magic bytes: 0x1f 0x8b
    expect(raw[0]).toBe(0x1f);
    expect(raw[1]).toBe(0x8b);

    // Verify gunzipSync produces valid JSON
    const decompressed = gunzipSync(raw).toString();
    const parsed = JSON.parse(decompressed);
    expect(parsed).toHaveProperty('data');
    expect(parsed.data).toEqual({ value: 42 });
    expect(parsed).toHaveProperty('fetchedAt');
    expect(parsed).toHaveProperty('ttl');
  });

  it('TTL expiry — isFresh() returns false after TTL, but get() still returns data', async () => {
    vi.useFakeTimers();

    await cache.set('stale', 'stale-value', 1);

    // Advance time past TTL
    vi.advanceTimersByTime(10);

    const fresh = await cache.isFresh('stale');
    expect(fresh).toBe(false);

    // Stale data is still retrievable
    const data = await cache.get<string>('stale');
    expect(data).toBe('stale-value');
  });

  it('has() returns false before set, true after set', async () => {
    expect(await cache.has('newkey')).toBe(false);
    await cache.set('newkey', 123);
    expect(await cache.has('newkey')).toBe(true);
  });

  it('clear() removes all entries and keys() returns []', async () => {
    await cache.set('a', 1);
    await cache.set('b', 2);
    await cache.set('c', 3);

    await cache.clear();

    expect(await cache.keys()).toEqual([]);
  });

  it('keys() returns all key names without .json.gz extension', async () => {
    await cache.set('alpha', 1);
    await cache.set('beta', 2);
    await cache.set('gamma', 3);

    const keys = await cache.keys();
    expect(keys.sort()).toEqual(['alpha', 'beta', 'gamma']);
  });

  it('get non-existent key returns null', async () => {
    const result = await cache.get('does-not-exist');
    expect(result).toBeNull();
  });

  it('isFresh on non-existent key returns false', async () => {
    const fresh = await cache.isFresh('does-not-exist');
    expect(fresh).toBe(false);
  });

  it('isFresh() returns true within TTL', async () => {
    await cache.set('fresh', 'value', 60000);
    const fresh = await cache.isFresh('fresh');
    expect(fresh).toBe(true);
  });
});

describe('MemoryCache', () => {
  let cache: MemoryCache;

  beforeEach(() => {
    cache = new MemoryCache();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('set → get roundtrip', async () => {
    await cache.set('key1', { name: 'test', value: 99 });
    const result = await cache.get<{ name: string; value: number }>('key1');
    expect(result).toEqual({ name: 'test', value: 99 });
  });

  it('TTL expiry — isFresh() returns false after TTL, get() still returns data', async () => {
    vi.useFakeTimers();

    await cache.set('stale', 'mem-stale', 1);

    vi.advanceTimersByTime(10);

    const fresh = await cache.isFresh('stale');
    expect(fresh).toBe(false);

    // Stale data is still retrievable
    const data = await cache.get<string>('stale');
    expect(data).toBe('mem-stale');
  });

  it('has/clear/keys lifecycle', async () => {
    expect(await cache.has('x')).toBe(false);
    expect(await cache.keys()).toEqual([]);

    await cache.set('x', 1);
    await cache.set('y', 2);
    await cache.set('z', 3);

    expect(await cache.has('x')).toBe(true);
    expect(await cache.has('y')).toBe(true);
    expect((await cache.keys()).sort()).toEqual(['x', 'y', 'z']);

    await cache.clear();

    expect(await cache.has('x')).toBe(false);
    expect(await cache.keys()).toEqual([]);
  });

  it('isFresh() returns true within TTL', async () => {
    await cache.set('fresh', 'value', 60000);
    const fresh = await cache.isFresh('fresh');
    expect(fresh).toBe(true);
  });

  it('get non-existent key returns null', async () => {
    const result = await cache.get('does-not-exist');
    expect(result).toBeNull();
  });
});
