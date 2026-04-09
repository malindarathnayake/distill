# webtollm — Testing Harness

## Archetype

**Infrastructure Tool** — HTTP client + DOM parser. Tests mock the network boundary, use real parsing libraries, and validate extraction accuracy against known HTML fixtures.

## Operator Questions

| Question | Answer |
|----------|--------|
| What framework? | vitest ^3.1.0 |
| Where do tests live? | `src/__tests__/*.test.ts` |
| How to run all tests? | `npx vitest run` |
| How to run one test file? | `npx vitest run src/__tests__/extractor.test.ts` |
| How to run in watch mode? | `npx vitest` |
| Where are fixtures? | `test/fixtures/ora-00001.html`, `test/fixtures/ora-12154.html` |
| How were fixtures created? | Decompressed from `.validation-cache/*.html.gz` (real Oracle pages cached during design validation) |
| What gets mocked? | Global `fetch` (via `vi.fn()` or `vi.stubGlobal`) |
| What stays real? | cheerio, @toon-format/toon, filesystem (in tmpdir), zlib |

## Test Tiers

### Tier 1: Unit Tests (always run)

**What it tests:** Individual module logic in isolation.

**How to run:** `npx vitest run`

**When to run:** After every code change. Part of the phase checkpoint.

| Test File | Module Under Test | Mock Boundary | Key Assertions |
|-----------|-------------------|---------------|----------------|
| `errors.test.ts` | `src/errors.ts` | None | instanceof chain, code property, message, cause |
| `normalize.test.ts` | `src/normalize.ts` | None | Table-driven: input→output pairs, error cases |
| `descriptor-loader.test.ts` | `src/descriptor-loader.ts` | None (reads JSON files) | Bundled load, URL matching, user override |
| `extractor.test.ts` | `src/extractor.ts` | None (reads fixture HTML) | Field extraction accuracy on ORA-00001, ORA-12154 |
| `fetcher.test.ts` | `src/fetcher.ts` | Mock `global.fetch` | 200/404/429/timeout/network error paths, retry logic |
| `cache.test.ts` | `src/cache.ts` | Real filesystem (tmpdir) | set→get roundtrip, gzip, TTL, clear, keys |
| `formatters.test.ts` | `src/formatters/` | None | TOON/Markdown/JSON output correctness |
| `index.test.ts` | `src/index.ts` | Mock `global.fetch` | Client integration: fetch→extract→cache→format |
| `warming.test.ts` | `src/index.ts` (warm) | Mock `global.fetch` | Stale re-fetch, warmAll from index, concurrency |
| `cli.test.ts` | `src/cli.ts` | Mock `global.fetch` | Arg parsing, output format, exit codes |

### Tier 2: Mocked Integration Tests (always run)

Included within the Tier 1 test files. These test multi-module paths with mocked HTTP:

- `index.test.ts`: Client class exercises normalize → descriptor loader → fetcher (mocked) → extractor (real + fixtures) → formatters → cache (real in tmpdir)
- `warming.test.ts`: Warming exercises client → fetcher (mocked) → cache lifecycle

### Tier 3: Live Integration Tests (manual, never in CI)

**Not automated.** The validation scripts (`mock-validate.mjs`, `mock-validate-stdocs.mjs`) serve as live integration tests. They hit real Oracle/MS docs and cache responses.

**How to run:** `node mock-validate.mjs` (uses `.validation-cache/` — only fetches if cache miss)

**When to run:** Manually, to verify extraction still works against live pages. Before npm publish.

### Tier 4: E2E (deferred)

No e2e framework in v1. The CLI tests in `cli.test.ts` exercise the full path programmatically.

## Archetype-Specific Patterns

### Fixture-Based Extraction Testing

The core value of webtollm is extraction accuracy. Test it with real HTML:

```typescript
// src/__tests__/extractor.test.ts
import { readFileSync } from 'fs';
import { describe, it, expect } from 'vitest';
import { extract } from '../extractor.js';

// Load descriptor
import oracleDescriptor from '../../descriptors/oracle-error-docs.json' with { type: 'json' };

// Load fixture (decompressed from .validation-cache/)
const ora00001Html = readFileSync('test/fixtures/ora-00001.html', 'utf-8');

describe('extract with oracle-error-docs descriptor', () => {
  const result = extract(ora00001Html, oracleDescriptor, 'https://docs.oracle.com/en/error-help/db/ora-00001/');

  it('extracts error code', () => {
    expect(result.code).toBe('ORA-00001');
  });

  it('extracts message', () => {
    expect(result.message).toContain('unique constraint');
  });

  it('extracts parameters', () => {
    expect(result.parameters).toBeInstanceOf(Array);
    expect(result.parameters.length).toBeGreaterThanOrEqual(1);
    // Check first parameter has name and description
    expect(result.parameters[0]).toHaveProperty('name');
    expect(result.parameters[0]).toHaveProperty('description');
  });

  it('extracts cause', () => {
    expect(result.cause).toBeTruthy();
    expect(typeof result.cause).toBe('string');
  });

  it('extracts action', () => {
    expect(result.action).toBeTruthy();
    expect(typeof result.action).toBe('string');
  });

  it('extracts SQL examples', () => {
    expect(result.sql).toBeInstanceOf(Array);
    expect(result.sql.length).toBeGreaterThanOrEqual(1);
  });

  it('sets release from section attribute', () => {
    expect(result.release).toBeTruthy();
  });

  it('sets url from input', () => {
    expect(result.url).toBe('https://docs.oracle.com/en/error-help/db/ora-00001/');
  });
});
```

### Table-Driven Normalization Testing

```typescript
// src/__tests__/normalize.test.ts
import { describe, it, expect } from 'vitest';
import { normalizeOraCode } from '../normalize.js';

describe('normalizeOraCode', () => {
  const validCases: [string, string][] = [
    ['ORA-00001', 'ora-00001'],
    ['ora-00001', 'ora-00001'],
    ['ORA-1', 'ora-00001'],
    ['ora00001', 'ora-00001'],
    ['ORA-12154', 'ora-12154'],
    ['  ORA-00001  ', 'ora-00001'],
    ['ORA-54', 'ora-00054'],
  ];

  it.each(validCases)('normalizes %s to %s', (input, expected) => {
    expect(normalizeOraCode(input)).toBe(expected);
  });

  const errorCases: [string, string][] = [
    ['', 'empty'],
    ['   ', 'empty'],
    ['TNS-12154', 'Only ORA prefix'],
    ['ORA-abc', 'Non-numeric'],
    ['ORA-100000', 'exceeds'],
    ['INVALID', 'invalid'],
  ];

  it.each(errorCases)('throws InvalidCodeError for %s', (input) => {
    expect(() => normalizeOraCode(input)).toThrow();
  });
});
```

### Mock Fetch Pattern

```typescript
// Common pattern for fetcher and client tests
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';

const fixtureHtml = readFileSync('test/fixtures/ora-00001.html', 'utf-8');

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.restoreAllMocks();
});

// Mock successful response
(fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
  new Response(fixtureHtml, { status: 200 })
);

// Mock 404
(fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
  new Response('Not Found', { status: 404 })
);

// Mock 429 then success (retry test)
(fetch as ReturnType<typeof vi.fn>)
  .mockResolvedValueOnce(new Response('Too Many Requests', { status: 429 }))
  .mockResolvedValueOnce(new Response(fixtureHtml, { status: 200 }));
```

### Filesystem Cache Testing with Tmpdir

```typescript
// src/__tests__/cache.test.ts
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FilesystemCache } from '../cache.js';

let tmpDir: string;
let cache: FilesystemCache;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'webtollm-test-'));
  cache = new FilesystemCache(tmpDir, 60000); // 60s TTL for tests
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});
```

## Quick Reference

| Action | Command |
|--------|---------|
| Run all tests | `npx vitest run` |
| Run one test file | `npx vitest run src/__tests__/extractor.test.ts` |
| Run tests matching pattern | `npx vitest run -t "normalizes"` |
| Watch mode | `npx vitest` |
| Type check only | `npx tsc --noEmit` |
| Build | `npx tsc` |
| Create fixture from cache | `node -e "const {gunzipSync}=require('zlib');const {readFileSync,writeFileSync}=require('fs');writeFileSync('test/fixtures/ora-00001.html',gunzipSync(readFileSync('.validation-cache/ora-00001.html.gz')))"` |

## Pre-Implementation Discovery

No deferred discovery items. All integration points verified during design:

- Oracle error doc DOM: verified on 8 pages, selectors stable
- Oracle standard doc DOM: verified on 4 pages
- @toon-format/toon API: `encode(input, options?)` → string, confirmed from type definitions
- cheerio API: `cheerio.load(html)` → jQuery-like `$`, confirmed from existing mock-validate scripts
- Native `fetch()`: available in Node.js v24.14.0 (stable since v21)
- `AbortSignal.timeout()`: available in Node.js v24.14.0 (stable since v17.3)
