import * as cheerio from 'cheerio';
import { normalizeOraCode } from './normalize.js';
import { createFetcher } from './fetcher.js';
import type { Fetcher } from './fetcher.js';
import { loadDescriptors, matchDescriptor } from './descriptor-loader.js';
import { extract as extractFromHtml } from './extractor.js';
import { FilesystemCache, MemoryCache } from './cache.js';
import { format } from './formatters/index.js';
import { ExtractionError, IndexFetchError } from './errors.js';
import type {
  OracleError,
  ErrorIndex,
  DistillConfig,
  FetchOptions,
  WarmOptions,
  CacheProvider,
  Descriptor,
} from './types.js';

// Re-export types
export type {
  OracleError,
  ErrorIndex,
  DistillConfig,
  FetchOptions,
  WarmOptions,
  FormatType,
  CacheProvider,
  Descriptor,
  Parameter,
} from './types.js';

// Re-export error classes
export {
  DistillError,
  InvalidCodeError,
  ErrorNotFoundError,
  FetchTimeoutError,
  NetworkError,
  ExtractionError,
  IndexFetchError,
} from './errors.js';

// Re-export format utility
export { format } from './formatters/index.js';

// Re-export cache providers
export { FilesystemCache, MemoryCache } from './cache.js';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class Distill {
  private cache: CacheProvider | null;
  private fetcher: Fetcher;
  private descriptors: Descriptor[];
  private cacheTtl: number;
  private baseUrl: string;
  private debug: boolean;

  constructor(config?: DistillConfig) {
    if (config?.cache === false) {
      this.cache = null;
    } else if (config?.cache != null) {
      this.cache = config.cache;
    } else {
      this.cache = new FilesystemCache(undefined, config?.cacheTtl);
    }

    this.fetcher = createFetcher({
      timeout: config?.timeout ?? 10000,
      debug: config?.debug,
    });

    this.descriptors = loadDescriptors(config?.descriptors);
    this.baseUrl = config?.baseUrl ?? 'https://docs.oracle.com/en/error-help/db/';
    this.cacheTtl = config?.cacheTtl ?? 86400000;
    this.debug = config?.debug ?? false;
  }

  async fetchError(code: string, options?: FetchOptions): Promise<OracleError> {
    const normalizedCode = normalizeOraCode(code);
    const url = `${this.baseUrl}${normalizedCode}/`;

    // Try cache if enabled and not bypassed
    if (this.cache !== null && !options?.noCache) {
      const cached = await this.cache.get<OracleError>(normalizedCode);
      if (cached !== null) {
        const fresh = await this.cache.isFresh(normalizedCode);
        if (fresh) {
          return cached;
        }
        // Stale: return immediately and refresh in background
        Promise.resolve()
          .then(async () => {
            const html = await this.fetcher.get(url);
            const descriptor = this.descriptors.find((d) => d.name === 'oracle-error-docs');
            if (!descriptor) return;
            const data = extractFromHtml(html, descriptor, url) as unknown as OracleError;
            await this.cache!.set(normalizedCode, data, this.cacheTtl);
          })
          .catch(() => {
            // fire-and-forget: ignore errors
          });
        return cached;
      }
    }

    // Fetch from network
    const html = await this.fetcher.get(url);
    const descriptor = this.descriptors.find((d) => d.name === 'oracle-error-docs');
    if (!descriptor) {
      throw new ExtractionError('oracle-error-docs descriptor not found', url);
    }
    const data = extractFromHtml(html, descriptor, url) as unknown as OracleError;

    // Cache the result
    if (this.cache !== null) {
      await this.cache.set(normalizedCode, data, this.cacheTtl);
    }

    return data;
  }

  async fetchErrors(codes: string[], options?: FetchOptions): Promise<OracleError[]> {
    const results: OracleError[] = [];
    for (let i = 0; i < codes.length; i++) {
      if (i > 0) await delay(100);
      results.push(await this.fetchError(codes[i], options));
    }
    return results;
  }

  async listErrors(): Promise<ErrorIndex[]> {
    const descriptor = this.descriptors.find((d) => d.name === 'oracle-error-docs' && d.index);
    if (!descriptor || !descriptor.index) {
      throw new IndexFetchError('(no index descriptor found)');
    }

    const indexUrl = descriptor.index.url;
    let html: string;
    try {
      html = await this.fetcher.get(indexUrl);
    } catch (err) {
      throw new IndexFetchError(indexUrl, err instanceof Error ? err : undefined);
    }

    const $ = cheerio.load(html);
    const itemSelector = descriptor.index.item_selector;
    const itemExtract = descriptor.index.item_extract;

    const items: ErrorIndex[] = [];
    $(itemSelector).each((_i, el) => {
      const $el = $(el);

      let code = '';
      let itemUrl = '';

      for (const [fieldName, fieldConfig] of Object.entries(itemExtract)) {
        let value = '';
        if (fieldConfig.source === 'text') {
          value = $el.text().trim();
        } else if (fieldConfig.source === 'attr' && fieldConfig.attr) {
          value = $el.attr(fieldConfig.attr) ?? '';
        }
        if (fieldName === 'code') code = value;
        if (fieldName === 'url') itemUrl = value;
      }

      if (code && itemUrl) {
        // Make URLs absolute
        if (!itemUrl.startsWith('http://') && !itemUrl.startsWith('https://')) {
          itemUrl = this.baseUrl + itemUrl;
        }
        items.push({ code, url: itemUrl });
      }
    });

    return items;
  }

  async extract(url: string, options?: FetchOptions): Promise<Record<string, unknown>> {
    const descriptor = matchDescriptor(url, this.descriptors);
    if (!descriptor) {
      throw new ExtractionError('No descriptor matches URL', url);
    }

    const html = await this.fetcher.get(url);
    return extractFromHtml(html, descriptor, url);
  }

  private async warmOne(code: string): Promise<void> {
    const normalizedCode = normalizeOraCode(code);
    const url = `${this.baseUrl}${normalizedCode}/`;
    const descriptor = this.descriptors.find((d) => d.name === 'oracle-error-docs');
    if (!descriptor) return;
    const html = await this.fetcher.get(url);
    const data = extractFromHtml(html, descriptor, url) as unknown as OracleError;
    await this.cache!.set(normalizedCode, data, this.cacheTtl);
  }

  async warm(opts?: WarmOptions): Promise<void> {
    if (this.cache === null) {
      throw new Error('Cache is disabled — cannot warm');
    }

    let codes: string[];
    if (opts?.codes != null) {
      codes = opts.codes.map((c) => normalizeOraCode(c));
    } else {
      const allKeys = await this.cache.keys();
      const freshnessChecks = await Promise.all(allKeys.map((k) => this.cache!.isFresh(k)));
      codes = allKeys.filter((_, i) => !freshnessChecks[i]);
    }

    const total = codes.length;
    const concurrency = opts?.concurrency ?? 5;
    let done = 0;

    for (let i = 0; i < codes.length; i += concurrency) {
      const chunk = codes.slice(i, i + concurrency);
      await Promise.all(
        chunk.map(async (code) => {
          try {
            await this.warmOne(code);
          } catch (err) {
            if (this.debug) {
              console.warn(`[distill] warm: failed to warm ${code}`, err);
            }
          }
          done++;
          opts?.onProgress?.(done, total);
        }),
      );
    }
  }

  async warmAll(): Promise<void> {
    if (this.cache === null) {
      throw new Error('Cache is disabled — cannot warm');
    }

    const index = await this.listErrors();
    const codes = index.map((item) => item.code);
    await this.warm({ codes, concurrency: 5 });
  }
}

export default Distill;
