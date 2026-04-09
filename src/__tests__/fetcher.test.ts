import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createFetcher } from '../fetcher.js';
import { ErrorNotFoundError, FetchTimeoutError, NetworkError } from '../errors.js';

function makeResponse(status: number, body = ''): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    text: () => Promise.resolve(body),
  } as unknown as Response;
}

describe('createFetcher', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('success — returns HTML on 200', async () => {
    const html = '<html><body>Hello</body></html>';
    mockFetch.mockResolvedValueOnce(makeResponse(200, html));

    const fetcher = createFetcher({});
    const result = await fetcher.get('https://example.com/page');
    expect(result).toBe(html);
  });

  it('404 → throws ErrorNotFoundError with correct errorCode and url', async () => {
    mockFetch.mockResolvedValueOnce(makeResponse(404));

    const fetcher = createFetcher({});
    const url = 'https://docs.oracle.com/en/error-help/db/ora-00001/';

    try {
      await fetcher.get(url);
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ErrorNotFoundError);
      const notFound = err as ErrorNotFoundError;
      expect(notFound.errorCode).toBe('ora-00001');
      expect(notFound.url).toBe(url);
    }
  });

  it('429 → retry → success returns HTML after two 429s', async () => {
    vi.useFakeTimers();
    const html = '<html>OK</html>';
    mockFetch
      .mockResolvedValueOnce(makeResponse(429))
      .mockResolvedValueOnce(makeResponse(429))
      .mockResolvedValueOnce(makeResponse(200, html));

    const fetcher = createFetcher({});
    const promise = fetcher.get('https://example.com/retry');

    // advance timers for exponential backoff: 1000ms then 2000ms
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(2000);

    const result = await promise;
    expect(result).toBe(html);
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('429 x3 retries exhausted → throws NetworkError', async () => {
    vi.useFakeTimers();
    mockFetch
      .mockResolvedValueOnce(makeResponse(429))
      .mockResolvedValueOnce(makeResponse(429))
      .mockResolvedValueOnce(makeResponse(429))
      .mockResolvedValueOnce(makeResponse(429));

    const fetcher = createFetcher({});
    const url = 'https://example.com/rate-limited';

    // Attach rejection handler BEFORE advancing timers so the rejection is never unhandled
    const errorPromise = expect(fetcher.get(url)).rejects.toThrow(NetworkError);

    // advance all retries: 1000ms + 2000ms + 4000ms
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(2000);
    await vi.advanceTimersByTimeAsync(4000);

    await errorPromise;
    expect(mockFetch).toHaveBeenCalledTimes(4);
  });

  it('timeout → throws FetchTimeoutError', async () => {
    const timeoutError = new DOMException('signal timed out', 'TimeoutError');
    mockFetch.mockRejectedValueOnce(timeoutError);

    const fetcher = createFetcher({ timeout: 5000 });
    const url = 'https://example.com/slow';
    await expect(fetcher.get(url)).rejects.toThrow(FetchTimeoutError);

    mockFetch.mockRejectedValueOnce(timeoutError);
    try {
      await fetcher.get(url);
    } catch (err) {
      expect(err).toBeInstanceOf(FetchTimeoutError);
      const timeoutErr = err as FetchTimeoutError;
      expect(timeoutErr.url).toBe(url);
      expect(timeoutErr.timeoutMs).toBe(5000);
    }
  });

  it('network error (TypeError) → throws NetworkError with original as cause', async () => {
    const typeError = new TypeError('Failed to fetch');
    mockFetch.mockRejectedValueOnce(typeError);

    const fetcher = createFetcher({});
    const url = 'https://example.com/no-dns';

    try {
      await fetcher.get(url);
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(NetworkError);
      const networkErr = err as NetworkError;
      expect(networkErr.cause).toBe(typeError);
    }
  });

  it('other non-2xx status → throws NetworkError', async () => {
    mockFetch.mockResolvedValueOnce(makeResponse(500));

    const fetcher = createFetcher({});
    await expect(fetcher.get('https://example.com/error')).rejects.toThrow(NetworkError);
  });

  it('getBatch — fetches all URLs and returns results in order', async () => {
    vi.useFakeTimers();
    const responses = ['<html>1</html>', '<html>2</html>', '<html>3</html>'];
    mockFetch
      .mockResolvedValueOnce(makeResponse(200, responses[0]))
      .mockResolvedValueOnce(makeResponse(200, responses[1]))
      .mockResolvedValueOnce(makeResponse(200, responses[2]));

    const fetcher = createFetcher({});
    const urls = [
      'https://example.com/1',
      'https://example.com/2',
      'https://example.com/3',
    ];

    const promise = fetcher.getBatch(urls, 100);

    // advance timers for rate-limiting delays between fetches
    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(100);

    const results = await promise;
    expect(results).toEqual(responses);
    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(mockFetch).toHaveBeenNthCalledWith(1, urls[0], expect.any(Object));
    expect(mockFetch).toHaveBeenNthCalledWith(2, urls[1], expect.any(Object));
    expect(mockFetch).toHaveBeenNthCalledWith(3, urls[2], expect.any(Object));
  });

  it('getBatch — individual failure propagates', async () => {
    mockFetch
      .mockResolvedValueOnce(makeResponse(200, '<html>1</html>'))
      .mockResolvedValueOnce(makeResponse(500))
      .mockResolvedValueOnce(makeResponse(200, '<html>3</html>'));

    const fetcher = createFetcher({});
    const urls = [
      'https://example.com/1',
      'https://example.com/2',
      'https://example.com/3',
    ];

    await expect(fetcher.getBatch(urls)).rejects.toThrow(NetworkError);
  });

  it('debug logging — console.log called with URL and status', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    mockFetch.mockResolvedValueOnce(makeResponse(200, '<html>ok</html>'));

    const fetcher = createFetcher({ debug: true });
    const url = 'https://example.com/debug';
    await fetcher.get(url);

    expect(consoleSpy).toHaveBeenCalledTimes(1);
    const logArg = consoleSpy.mock.calls[0].join(' ');
    expect(logArg).toContain(url);
    expect(logArg).toContain('200');
  });
});
