# Distill — Project Directives

## Project
Descriptor-driven web content extraction tool. Extracts structured data from documentation pages and outputs in TOON, Markdown, or JSON formats. Ships with Oracle error docs support; new sources added via JSON descriptor files.

## Build & Test
```bash
npm install           # install deps
npx vitest run        # run 160 tests
npx tsc --noEmit      # type check
npx tsc               # build to dist/
node dist/cli.js --help  # verify CLI
```

## Package for Local Testing
```bash
npx tsc && npm pack --pack-destination ./artifacts
# Install in another project:
# npm install /path/to/distill/artifacts/distill-1.0.0.tgz
```

## Key Architecture
- **ESM-only** (`"type": "module"`, `module: "NodeNext"`)
- **Extraction engine** is generic — CSS selectors + extraction types defined in JSON descriptors
- **Oracle is the default provider** — descriptors in `descriptors/`, normalizer in `src/normalize.ts`
- **Three output formats**: TOON (LLM-optimized), Markdown (human), JSON (programmatic)
- **Cache**: gzip-compressed filesystem cache at `~/.distill/cache/`, 24h TTL, stale-while-revalidate

## File Layout
| Path | Purpose |
|------|---------|
| `src/index.ts` | `Distill` class — public API |
| `src/cli.ts` | CLI (`run()` function, no auto-execute) |
| `src/extractor.ts` | Generic DOM extraction engine |
| `src/normalize.ts` | ORA code normalization |
| `src/fetcher.ts` | HTTP fetcher with retry/backoff |
| `src/cache.ts` | FilesystemCache + MemoryCache |
| `src/formatters/` | TOON, Markdown, JSON formatters |
| `src/errors.ts` | Error hierarchy (extends `DistillError`) |
| `src/types.ts` | All TypeScript interfaces |
| `descriptors/` | Bundled extraction descriptors |
| `bin/distill.mjs` | CLI entry point (imports `dist/cli.js`) |
| `scripts/create-descriptor.mjs` | Helper to generate descriptors from a URL |
| `Samples/` | Example usage scripts |
| `Docs/` | Spec, handoff, design summary, testing harness |

## Naming Conventions
- Package: `distill`
- Class: `Distill`
- Config type: `DistillConfig`
- Error base: `DistillError`
- Cache dir: `~/.distill/cache/`
- CLI: `distill` (via `bin/distill.mjs`)

## Testing Rules
- Mock HTTP (`vi.stubGlobal('fetch', mockFetch)`)
- Real cheerio, real @toon-format/toon — never mock these
- Use `MemoryCache` in tests (no filesystem)
- Fixtures in `test/fixtures/` (decompressed from `.validation-cache/`)
- `.js` extensions in all imports (ESM + NodeNext)

## Descriptor Generator
```bash
npm run create-descriptor -- <url> [--name <name>] [--out <path>] [--verbose] [--root <selector>]
```

## Do Not
- Export internal modules (extractor, fetcher, descriptor-loader) from index.ts
- Add arg parsing libraries (commander, yargs) to CLI
- Mock cheerio or @toon-format/toon in tests
- Modify bundled descriptor JSON files unless a test reveals a bug
