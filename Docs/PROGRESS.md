# Progress

## Foundation

- [x] 1.1: Retroactive: scaffolding (tsconfig, vitest, package.json) completed in prior session. 84 tests pass. (2026-04-09T16:04:00Z)
- [x] 1.2: Retroactive: types.ts + errors.ts + 36 error tests passing. (2026-04-09T16:04:00Z)

## phase-2

- [x] 2.1: Retroactive: normalize.ts + 13 tests passing. (2026-04-09T16:04:00Z)
- [x] 2.2: Retroactive: descriptor-loader.ts + 6 tests passing. (2026-04-09T16:04:00Z)
- [x] 2.3: Retroactive: extractor.ts + 29 tests passing. (2026-04-09T16:04:00Z)

## phase-3

- [x] 3.1: HTTP Fetcher: createFetcher with get/getBatch, 429 retry with backoff, timeout/404/network error handling, debug logging. 9 tests pass. (2026-04-09T16:08:00Z)
- [x] 3.2: Cache Providers: FilesystemCache (gzip, lazy dir, TTL) + MemoryCache (Map-based). 11 tests pass. (2026-04-09T16:10:30Z)

## phase-4

- [x] 4.1: Output Formatters: toon.ts (encode wrapper), markdown.ts (structured sections), json.ts (stringify wrapper), index.ts (format dispatcher). 23 tests pass. Codex+Gemini review clean — 4 test gaps fixed. 131 total tests, tsc clean. (2026-04-09T18:16:05Z)

## phase-5

- [x] 5.1: Client Class: Webtollm with fetchError (cache + stale bg refresh), fetchErrors (100ms rate limit), listErrors (cheerio index parse), extract (matchDescriptor + generic extraction). Re-exports types, errors, format, cache providers. 10 tests pass. 141 total. (2026-04-09T18:22:00Z)
- [x] 5.2: Cache Warming: warm() with stale filtering, chunked concurrency (default 5), onProgress, error isolation. warmAll() via listErrors. Both require cache enabled. 7 tests pass. 148 total. (2026-04-09T18:25:00Z)
- [x] 5.3: CLI: manual arg parsing (--format, --no-cache, --list, --warm, --warm-all, --help). Auto-run with import.meta.url guard. bin/webtollm.mjs entry point. Review fixes: format validation, try/catch all paths, warmAll progress. 11 CLI tests. 160 total tests, tsc builds, CLI --help works. (2026-04-09T18:51:00Z)

