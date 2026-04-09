import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { gzipSync, gunzipSync } from 'node:zlib';
import type { CacheProvider } from './types.js';

interface CacheEntry<T> {
  data: T;
  fetchedAt: number;
  ttl: number;
}

class FilesystemCache implements CacheProvider {
  private cacheDir: string;
  private defaultTtl: number;
  private dirCreated: boolean;

  constructor(
    cacheDir: string = path.join(os.homedir(), '.distill', 'cache'),
    defaultTtl: number = 86400000,
  ) {
    this.cacheDir = cacheDir;
    this.defaultTtl = defaultTtl;
    this.dirCreated = false;
  }

  private filePath(key: string): string {
    return path.join(this.cacheDir, `${key}.json.gz`);
  }

  private ensureDir(): void {
    if (!this.dirCreated) {
      fs.mkdirSync(this.cacheDir, { recursive: true });
      this.dirCreated = true;
    }
  }

  async get<T>(key: string): Promise<T | null> {
    const file = this.filePath(key);
    if (!fs.existsSync(file)) {
      return null;
    }
    const compressed = fs.readFileSync(file);
    const raw = gunzipSync(compressed);
    const entry = JSON.parse(raw.toString()) as CacheEntry<T>;
    return entry.data;
  }

  async set<T>(key: string, value: T, ttl?: number): Promise<void> {
    this.ensureDir();
    const entry: CacheEntry<T> = {
      data: value,
      fetchedAt: Date.now(),
      ttl: ttl ?? this.defaultTtl,
    };
    const json = JSON.stringify(entry);
    const compressed = gzipSync(json);
    fs.writeFileSync(this.filePath(key), compressed);
  }

  async has(key: string): Promise<boolean> {
    return fs.existsSync(this.filePath(key));
  }

  async isFresh(key: string): Promise<boolean> {
    const file = this.filePath(key);
    if (!fs.existsSync(file)) {
      return false;
    }
    const compressed = fs.readFileSync(file);
    const raw = gunzipSync(compressed);
    const entry = JSON.parse(raw.toString()) as CacheEntry<unknown>;
    return Date.now() < entry.fetchedAt + entry.ttl;
  }

  async clear(): Promise<void> {
    if (!fs.existsSync(this.cacheDir)) {
      return;
    }
    const files = fs.readdirSync(this.cacheDir);
    for (const file of files) {
      if (file.endsWith('.json.gz')) {
        fs.unlinkSync(path.join(this.cacheDir, file));
      }
    }
  }

  async keys(): Promise<string[]> {
    if (!fs.existsSync(this.cacheDir)) {
      return [];
    }
    const files = fs.readdirSync(this.cacheDir);
    return files
      .filter((f) => f.endsWith('.json.gz'))
      .map((f) => f.slice(0, -'.json.gz'.length));
  }
}

class MemoryCache implements CacheProvider {
  private map: Map<string, { data: unknown; fetchedAt: number; ttl: number }>;
  private defaultTtl: number;

  constructor(defaultTtl: number = 86400000) {
    this.map = new Map();
    this.defaultTtl = defaultTtl;
  }

  async get<T>(key: string): Promise<T | null> {
    const entry = this.map.get(key);
    if (!entry) {
      return null;
    }
    return entry.data as T;
  }

  async set<T>(key: string, value: T, ttl?: number): Promise<void> {
    this.map.set(key, {
      data: value,
      fetchedAt: Date.now(),
      ttl: ttl ?? this.defaultTtl,
    });
  }

  async has(key: string): Promise<boolean> {
    return this.map.has(key);
  }

  async isFresh(key: string): Promise<boolean> {
    const entry = this.map.get(key);
    if (!entry) {
      return false;
    }
    return Date.now() < entry.fetchedAt + entry.ttl;
  }

  async clear(): Promise<void> {
    this.map.clear();
  }

  async keys(): Promise<string[]> {
    return Array.from(this.map.keys());
  }
}

export { FilesystemCache, MemoryCache };
