import { ErrorNotFoundError, FetchTimeoutError, NetworkError } from './errors.js';

export interface FetcherConfig {
  timeout?: number;
  debug?: boolean;
}

export interface Fetcher {
  get(url: string): Promise<string>;
  getBatch(urls: string[], rateMs?: number): Promise<string[]>;
}

function extractErrorCode(url: string): string {
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.split('/').filter((s) => s.length > 0);
    return segments[segments.length - 1] ?? url;
  } catch {
    return url;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createFetcher(config: FetcherConfig): Fetcher {
  const timeout = config.timeout ?? 10000;
  const debug = config.debug ?? false;

  async function get(url: string): Promise<string> {
    const maxRetries = 3;
    let attempt = 0;

    while (true) {
      const start = Date.now();
      let response: Response;

      try {
        response = await fetch(url, { signal: AbortSignal.timeout(timeout) });
      } catch (err) {
        if (err instanceof DOMException && err.name === 'TimeoutError') {
          throw new FetchTimeoutError(url, timeout);
        }
        if (err instanceof TypeError) {
          throw new NetworkError(url, err);
        }
        throw new NetworkError(url, err instanceof Error ? err : undefined);
      }

      if (debug) {
        const elapsed = Date.now() - start;
        console.log(`[fetcher] ${url} ${response.status} ${elapsed}ms`);
      }

      if (response.status === 404) {
        const errorCode = extractErrorCode(url);
        throw new ErrorNotFoundError(errorCode, url);
      }

      if (response.status === 429) {
        if (attempt < maxRetries) {
          const waitMs = 1000 * Math.pow(2, attempt);
          attempt++;
          await delay(waitMs);
          continue;
        }
        throw new NetworkError(url);
      }

      if (response.ok) {
        return response.text();
      }

      throw new NetworkError(url);
    }
  }

  async function getBatch(urls: string[], rateMs = 100): Promise<string[]> {
    const results: string[] = [];
    for (let i = 0; i < urls.length; i++) {
      if (i > 0) {
        await delay(rateMs);
      }
      results.push(await get(urls[i]));
    }
    return results;
  }

  return { get, getBatch };
}
