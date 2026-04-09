export class DistillError extends Error {
  code: string;

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.code = code;
    this.name = 'DistillError';
  }
}

export class InvalidCodeError extends DistillError {
  constructor(message: string) {
    super('INVALID_CODE', message);
    this.name = 'InvalidCodeError';
  }
}

export class ErrorNotFoundError extends DistillError {
  errorCode: string;
  url: string;

  constructor(errorCode: string, url: string) {
    super('NOT_FOUND', `Error ${errorCode} not found at ${url}`);
    this.name = 'ErrorNotFoundError';
    this.errorCode = errorCode;
    this.url = url;
  }
}

export class FetchTimeoutError extends DistillError {
  url: string;
  timeoutMs: number;

  constructor(url: string, timeoutMs: number) {
    super('TIMEOUT', `Request to ${url} timed out after ${timeoutMs}ms`);
    this.name = 'FetchTimeoutError';
    this.url = url;
    this.timeoutMs = timeoutMs;
  }
}

export class NetworkError extends DistillError {
  url: string;

  constructor(url: string, cause?: Error) {
    super('NETWORK_ERROR', `Network error fetching ${url}`, { cause });
    this.name = 'NetworkError';
    this.url = url;
  }
}

export class ExtractionError extends DistillError {
  url: string;

  constructor(message: string, url: string) {
    super('EXTRACTION_ERROR', message);
    this.name = 'ExtractionError';
    this.url = url;
  }
}

export class IndexFetchError extends DistillError {
  indexUrl: string;

  constructor(indexUrl: string, cause?: Error) {
    super('INDEX_FETCH_ERROR', `Failed to fetch error index from ${indexUrl}`, { cause });
    this.name = 'IndexFetchError';
    this.indexUrl = indexUrl;
  }
}
