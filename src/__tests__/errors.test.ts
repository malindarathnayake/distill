import { describe, it, expect } from 'vitest';
import {
  DistillError,
  InvalidCodeError,
  ErrorNotFoundError,
  FetchTimeoutError,
  NetworkError,
  ExtractionError,
  IndexFetchError,
} from '../errors.js';

describe('DistillError', () => {
  it('is an instance of Error and DistillError', () => {
    const err = new DistillError('TEST_CODE', 'test message');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(DistillError);
  });

  it('sets code and message', () => {
    const err = new DistillError('MY_CODE', 'my message');
    expect(err.code).toBe('MY_CODE');
    expect(err.message).toBe('my message');
  });

  it('sets name to DistillError', () => {
    const err = new DistillError('X', 'x');
    expect(err.name).toBe('DistillError');
  });
});

describe('InvalidCodeError', () => {
  it('is an instance of Error, DistillError, and InvalidCodeError', () => {
    const err = new InvalidCodeError('bad code');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(DistillError);
    expect(err).toBeInstanceOf(InvalidCodeError);
  });

  it('has code INVALID_CODE', () => {
    const err = new InvalidCodeError('bad code');
    expect(err.code).toBe('INVALID_CODE');
  });

  it('has name InvalidCodeError', () => {
    const err = new InvalidCodeError('bad code');
    expect(err.name).toBe('InvalidCodeError');
  });

  it('sets message', () => {
    const err = new InvalidCodeError('bad code here');
    expect(err.message).toBe('bad code here');
  });
});

describe('ErrorNotFoundError', () => {
  it('is an instance of Error, DistillError, and ErrorNotFoundError', () => {
    const err = new ErrorNotFoundError('ORA-00001', 'https://example.com/ORA-00001');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(DistillError);
    expect(err).toBeInstanceOf(ErrorNotFoundError);
  });

  it('has code NOT_FOUND', () => {
    const err = new ErrorNotFoundError('ORA-00001', 'https://example.com/ORA-00001');
    expect(err.code).toBe('NOT_FOUND');
  });

  it('has name ErrorNotFoundError', () => {
    const err = new ErrorNotFoundError('ORA-00001', 'https://example.com/ORA-00001');
    expect(err.name).toBe('ErrorNotFoundError');
  });

  it('builds message from errorCode and url', () => {
    const err = new ErrorNotFoundError('ORA-00001', 'https://example.com/ORA-00001');
    expect(err.message).toBe('Error ORA-00001 not found at https://example.com/ORA-00001');
  });

  it('stores errorCode and url as extra properties', () => {
    const err = new ErrorNotFoundError('ORA-00001', 'https://example.com/ORA-00001');
    expect(err.errorCode).toBe('ORA-00001');
    expect(err.url).toBe('https://example.com/ORA-00001');
  });
});

describe('FetchTimeoutError', () => {
  it('is an instance of Error, DistillError, and FetchTimeoutError', () => {
    const err = new FetchTimeoutError('https://example.com', 5000);
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(DistillError);
    expect(err).toBeInstanceOf(FetchTimeoutError);
  });

  it('has code TIMEOUT', () => {
    const err = new FetchTimeoutError('https://example.com', 5000);
    expect(err.code).toBe('TIMEOUT');
  });

  it('has name FetchTimeoutError', () => {
    const err = new FetchTimeoutError('https://example.com', 5000);
    expect(err.name).toBe('FetchTimeoutError');
  });

  it('builds message from url and timeoutMs', () => {
    const err = new FetchTimeoutError('https://example.com', 5000);
    expect(err.message).toBe('Request to https://example.com timed out after 5000ms');
  });

  it('stores url and timeoutMs as extra properties', () => {
    const err = new FetchTimeoutError('https://example.com', 3000);
    expect(err.url).toBe('https://example.com');
    expect(err.timeoutMs).toBe(3000);
  });
});

describe('NetworkError', () => {
  it('is an instance of Error, DistillError, and NetworkError', () => {
    const err = new NetworkError('https://example.com');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(DistillError);
    expect(err).toBeInstanceOf(NetworkError);
  });

  it('has code NETWORK_ERROR', () => {
    const err = new NetworkError('https://example.com');
    expect(err.code).toBe('NETWORK_ERROR');
  });

  it('has name NetworkError', () => {
    const err = new NetworkError('https://example.com');
    expect(err.name).toBe('NetworkError');
  });

  it('builds message from url', () => {
    const err = new NetworkError('https://example.com');
    expect(err.message).toBe('Network error fetching https://example.com');
  });

  it('stores url as extra property', () => {
    const err = new NetworkError('https://example.com');
    expect(err.url).toBe('https://example.com');
  });

  it('chains cause when provided', () => {
    const cause = new Error('connection refused');
    const err = new NetworkError('https://example.com', cause);
    expect(err.cause).toBe(cause);
  });

  it('has no cause when not provided', () => {
    const err = new NetworkError('https://example.com');
    expect(err.cause).toBeUndefined();
  });
});

describe('ExtractionError', () => {
  it('is an instance of Error, DistillError, and ExtractionError', () => {
    const err = new ExtractionError('failed to extract', 'https://example.com');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(DistillError);
    expect(err).toBeInstanceOf(ExtractionError);
  });

  it('has code EXTRACTION_ERROR', () => {
    const err = new ExtractionError('failed to extract', 'https://example.com');
    expect(err.code).toBe('EXTRACTION_ERROR');
  });

  it('has name ExtractionError', () => {
    const err = new ExtractionError('failed to extract', 'https://example.com');
    expect(err.name).toBe('ExtractionError');
  });

  it('sets message', () => {
    const err = new ExtractionError('missing required field', 'https://example.com');
    expect(err.message).toBe('missing required field');
  });

  it('stores url as extra property', () => {
    const err = new ExtractionError('failed to extract', 'https://example.com/page');
    expect(err.url).toBe('https://example.com/page');
  });
});

describe('IndexFetchError', () => {
  it('is an instance of Error, DistillError, and IndexFetchError', () => {
    const err = new IndexFetchError('https://example.com/index');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(DistillError);
    expect(err).toBeInstanceOf(IndexFetchError);
  });

  it('has code INDEX_FETCH_ERROR', () => {
    const err = new IndexFetchError('https://example.com/index');
    expect(err.code).toBe('INDEX_FETCH_ERROR');
  });

  it('has name IndexFetchError', () => {
    const err = new IndexFetchError('https://example.com/index');
    expect(err.name).toBe('IndexFetchError');
  });

  it('builds message from indexUrl', () => {
    const err = new IndexFetchError('https://example.com/index');
    expect(err.message).toBe('Failed to fetch error index from https://example.com/index');
  });

  it('stores indexUrl as extra property', () => {
    const err = new IndexFetchError('https://example.com/index');
    expect(err.indexUrl).toBe('https://example.com/index');
  });

  it('chains cause when provided', () => {
    const cause = new Error('404 not found');
    const err = new IndexFetchError('https://example.com/index', cause);
    expect(err.cause).toBe(cause);
  });

  it('has no cause when not provided', () => {
    const err = new IndexFetchError('https://example.com/index');
    expect(err.cause).toBeUndefined();
  });
});
