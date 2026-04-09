# webtollm — Implementation Handoff

## Project Overview

Build a descriptor-driven web content extraction module for Node.js. Fetches documentation pages, extracts structured content via cheerio + JSON descriptors, outputs in TOON/Markdown/JSON formats optimized for LLM context injection. Ships with Oracle error docs support + generic extraction engine.

Full spec: [Docs/spec.md](spec.md)

## Before Starting

Every implementation session — first or resumed — must begin with:

1. Read `Docs/spec.md` — understand what to build
2. Read this file (`Docs/handoff.md`) — understand how to build it
3. Read `Docs/PROGRESS.md` — understand where you are
4. Read `Docs/testing-harness.md` — understand testing approach
5. Run `npx vitest run` — confirm current test state before changing anything

If any test is failing before you start, diagnose and fix it before proceeding to new work.

## Rules

1. **No scope additions.** Build exactly what the spec says. No extra features, config options, or "nice to have" improvements.
2. **No skipping tests.** Every unit has a test command. Run it before marking the unit done. All tests must pass.
3. **One unit at a time.** Complete the current unit (code + tests + passing) before starting the next.
4. **Forward dependencies only.** Never import from a later phase's modules. If you need something from Phase 3 while in Phase 2, you're doing it wrong.
5. **Mock at boundaries.** HTTP → mock `fetch`. Filesystem cache → real filesystem in tmpdir. cheerio → never mock. @toon-format/toon → never mock.
6. **Run the checkpoint.** After the last unit of each phase, run the phase checkpoint command. Do not proceed to the next phase until it passes.
7. **Update PROGRESS.md.** After completing each unit, update the checklist and session log.
8. **Use the existing prototype.** The extraction engine in `mock-validate.mjs` (lines 62-234) and `mock-validate-stdocs.mjs` (lines 38-213) is proven and tested against real pages. Port this logic to TypeScript — don't reinvent it.
9. **Descriptors are frozen.** The three JSON files in `descriptors/` are validated. Do not modify them unless a test fixture reveals a bug.
10. **Error classes carry context.** Every custom error must include the relevant URL, code, or timeout value — not just a message string.

## Implementation Order

### Phase 1: Foundation

**Unit 1.1: Project Scaffolding**
- Create `tsconfig.json`, `vitest.config.ts`
- Update `package.json` (ESM, scripts, deps)
- Run `npm install`
- **Pitfall:** `@toon-format/toon` is ESM-only. The project MUST use `"type": "module"` in package.json. Verify tsc compiles with `module: "NodeNext"`.
- **Verify:** `npx tsc --noEmit --pretty` passes

**Unit 1.2: Types and Error Classes**
- Create `src/types.ts` with all interfaces from spec
- Create `src/errors.ts` with 6 error classes + base class
- Create `src/__tests__/errors.test.ts`
- **Pitfall:** The `Descriptor` type must match the actual JSON structure of `descriptors/oracle-error-docs.json`. Read that file and type it precisely — don't guess the shape.
- **Dependency:** Descriptor JSON files in `descriptors/` are the source of truth for the `Descriptor` type.
- **Verify:** `npx vitest run src/__tests__/errors.test.ts`

**Phase 1 Checkpoint:** `npx tsc --noEmit && npx vitest run`

---

### Phase 2: Extraction Engine

**Unit 2.1: Code Normalization**
- Create `src/normalize.ts` and test
- **Pitfall:** The regex must handle missing dash (`ora00001`), short form (`ORA-1`), and extra whitespace.
- **Verify:** `npx vitest run src/__tests__/normalize.test.ts`

**Unit 2.2: Descriptor Loader**
- Create `src/descriptor-loader.ts` and test
- **Pitfall:** Resolving bundled descriptors relative to the package root. Use `import.meta.url` to find the `descriptors/` directory. Test that it works both from source (`src/`) and compiled (`dist/`).
- **Pitfall:** URL pattern matching — `{prefix}` and `{code}` are named captures, not literal braces. Convert pattern to regex: replace `{name}` with `([^/]+)`.
- **Dependency:** `descriptors/oracle-error-docs.json`, `descriptors/oracle-standard-docs.json` must be loadable.
- **Verify:** `npx vitest run src/__tests__/descriptor-loader.test.ts`

**Unit 2.3: Generic Extractor**
- Create `src/extractor.ts` and test
- Create `test/fixtures/ora-00001.html` and `test/fixtures/ora-12154.html` by decompressing from `.validation-cache/`
- **Pitfall:** The `heading_section` extraction type finds a heading by text match, then takes the **next sibling** matching `content_selector`. If the DOM has `<hr>` between heading and content div, `next(selector)` won't find it — use `nextAll(selector).first()` instead of `next(selector)`.
- **Pitfall:** The `nested_sections` type is recursive. Set `max_depth` guard (default 3) to prevent infinite recursion.
- **Pitfall:** The `repeating_group` type walks siblings via offset. If the DOM has unexpected elements between groups, offsets will be wrong. The existing `mock-validate.mjs` handles this correctly — port that logic.
- **Dependency:** Existing `mock-validate.mjs` lines 62-234 contain the proven extraction engine. Port to TypeScript, don't rewrite from scratch.
- **Dependency:** `descriptors/oracle-error-docs.json` for fixture tests.
- **Verify:** `npx vitest run src/__tests__/extractor.test.ts`

**Phase 2 Checkpoint:** `npx vitest run && npx tsc --noEmit`

---

### Phase 3: HTTP + Cache

**Unit 3.1: HTTP Fetcher**
- Create `src/fetcher.ts` and test
- **Pitfall:** `AbortSignal.timeout()` throws `DOMException` with name `'TimeoutError'`, not `'AbortError'`. Check `error.name === 'TimeoutError'` for timeout detection.
- **Pitfall:** `fetch()` throws `TypeError` on network failure (DNS, connection refused). Catch this specifically.
- **Pitfall:** For 429 retry, use `setTimeout`-based delay, not `Atomics.wait`. Backoff: 1000ms, 2000ms, 4000ms.
- **Verify:** `npx vitest run src/__tests__/fetcher.test.ts`

**Unit 3.2: Cache Providers**
- Create `src/cache.ts` and test
- **Pitfall:** `gzipSync`/`gunzipSync` are synchronous and block the event loop. For v1 this is acceptable (cache entries are small — typically 1-5KB compressed). If perf becomes an issue, switch to `gzip`/`gunzip` async variants later.
- **Pitfall:** `mkdirSync(dir, { recursive: true })` on every `set()` call is wasteful. Create directory once in constructor or on first write (lazy init).
- **Pitfall:** Race condition: concurrent `set()` calls on same key. For v1, last-write-wins is acceptable — don't add file locking.
- **Dependency:** `os.tmpdir()` for test isolation.
- **Verify:** `npx vitest run src/__tests__/cache.test.ts`

**Phase 3 Checkpoint:** `npx vitest run && npx tsc --noEmit`

---

### Phase 4: Formatters

**Unit 4.1: Output Formatters**
- Create `src/formatters/toon.ts`, `markdown.ts`, `json.ts`, `index.ts` and test
- **Pitfall:** TOON `encode()` from `@toon-format/toon` handles objects and arrays natively. Don't pre-process the data — pass the `OracleError` object directly.
- **Pitfall:** Markdown SQL blocks need triple-backtick fencing with `sql` language tag. The template literal must not have extra indentation inside the fenced block.
- **Dependency:** `@toon-format/toon` v2.1.0 — `encode(input, options?)` returns string.
- **Verify:** `npx vitest run src/__tests__/formatters.test.ts`

**Phase 4 Checkpoint:** `npx vitest run && npx tsc --noEmit`

---

### Phase 5: Public API + CLI

**Unit 5.1: Client Class**
- Create `src/index.ts` and test
- **Pitfall:** The stale cache path — return stale data immediately, trigger background refresh with `Promise` (fire-and-forget, catch errors silently). Don't `await` the refresh.
- **Pitfall:** `fetchErrors()` must rate-limit sequential calls (100ms gap). Don't fire all in parallel — Oracle will 429.
- **Pitfall:** Re-exports — `src/index.ts` must re-export types, errors, and format utility. Use `export type` for type-only exports to avoid runtime overhead.
- **Verify:** `npx vitest run src/__tests__/index.test.ts`

**Unit 5.2: Cache Warming**
- Extend `src/index.ts` with `warm()` and `warmAll()` methods
- **Pitfall:** `warmAll()` fetches ~3,500 pages. With 5 concurrency and 100ms rate limit per request, that's ~70 seconds minimum. The progress callback is essential for CLI UX.
- **Pitfall:** Chunking: split codes into groups of `concurrency` size, process each group with `Promise.all()`, then next group. Simpler than a semaphore pool and sufficient for v1.
- **Verify:** `npx vitest run src/__tests__/warming.test.ts`

**Unit 5.3: CLI**
- Create `src/cli.ts`, `bin/webtollm.mjs` and test
- **Pitfall:** Arg parsing without a library — handle `--format toon` (space-separated), not `--format=toon`. Support both forms if feasible, but space-separated is the minimum.
- **Pitfall:** `bin/webtollm.mjs` must import from `dist/cli.js` (compiled output). Ensure `tsc` compiles `src/cli.ts` → `dist/cli.js`.
- **Verify:** `npx vitest run src/__tests__/cli.test.ts`

**Phase 5 Checkpoint:** `npx vitest run && npx tsc && node dist/cli.js --help`

---

## Testing Strategy

**Archetype:** Infrastructure Tool (HTTP client + DOM parser)

See full details: [Docs/testing-harness.md](testing-harness.md)

**Key principle:** Mock HTTP, use real cheerio + real TOON + real filesystem. HTML fixtures from `.validation-cache/` provide ground truth.

## Quick Reference

### Checkpoint Commands

| Phase | Command | Passes When |
|-------|---------|-------------|
| 1 | `npx tsc --noEmit && npx vitest run` | Types compile, error class tests pass |
| 2 | `npx vitest run && npx tsc --noEmit` | Extraction engine tests pass on fixtures |
| 3 | `npx vitest run && npx tsc --noEmit` | Fetcher + cache tests pass |
| 4 | `npx vitest run && npx tsc --noEmit` | Formatter tests pass |
| 5 | `npx vitest run && npx tsc && node dist/cli.js --help` | Full suite passes, builds, CLI runs |

### Error Recovery

| Problem | Fix |
|---------|-----|
| tsc fails on @toon-format/toon import | Ensure `"module": "NodeNext"` and `"moduleResolution": "NodeNext"` in tsconfig.json. The package uses `.mts` exports. |
| vitest can't find tests | Check `vitest.config.ts` include pattern: `src/__tests__/**/*.test.ts` |
| Extractor test fails on field extraction | Compare with `mock-validate.mjs` logic. Check if `next()` vs `nextAll().first()` is the issue (see heading_section pitfall). |
| Cache test leaves files behind | Ensure `afterEach` cleanup in test. Use `fs.rmSync(tmpDir, { recursive: true, force: true })`. |
| Fixture HTML missing | Decompress from `.validation-cache/`: `gunzipSync(readFileSync('.validation-cache/ora-00001.html.gz'))` |
| Import errors in tests | Ensure test files use `.js` extension in imports (ESM + NodeNext requires file extensions) |

### Key File References

| Need | File |
|------|------|
| Proven extraction engine | `mock-validate.mjs:62-234` |
| Nested sections extraction | `mock-validate-stdocs.mjs:38-232` |
| Oracle error descriptor | `descriptors/oracle-error-docs.json` |
| Oracle standard descriptor | `descriptors/oracle-standard-docs.json` |
| DOM extraction map | `Docs/design-summary.md:182-209` |
| Descriptor spec | `Docs/dom-descriptor-spec.md` |
| Validation report | `Docs/validation-report.json` |
| Cached HTML fixtures | `.validation-cache/ora-*.html.gz` |

## Start

### First Session

1. Complete the Before Starting protocol above
2. Begin with **Phase 1, Unit 1.1: Project Scaffolding**
3. Follow the implementation order strictly — each unit builds on the previous

### Resuming Mid-Implementation

1. Complete the Before Starting protocol above
2. Read `Docs/PROGRESS.md` to find last completed unit
3. Resume from the next pending unit
4. If the last unit was left incomplete, finish it first before moving forward
