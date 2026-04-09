## Design Summary — webtollm

### Problem

LLMs working with Oracle databases frequently encounter ORA errors and need documentation context (cause, action, SQL examples) to diagnose issues. The Oracle error docs at `docs.oracle.com/en/error-help/db/` contain this information but are wrapped in ~85% boilerplate HTML (navigation, footers, duplicate legacy sections, scripts). No npm module exists that fetches these pages, extracts only the useful content, and outputs it in a token-efficient format suitable for LLM context injection.

Manually copying error docs wastes tokens on formatting. API services (Jina Reader, Firecrawl) add external dependencies and cost. General extraction libraries (Readability) lose structured content (parameters, code blocks) that matters for Oracle diagnostics.

### Approach

A lightweight Node.js npm module that:
1. Fetches Oracle error doc pages via HTTP (static HTML — no JS rendering needed)
2. Extracts structured content using targeted cheerio selectors on the known DOM
3. Returns a typed JS object with format methods: `.toTOON()`, `.toMarkdown()`, `.toJSON()`
4. Supports single error lookup, batch lookup, and index listing
5. Caches responses locally in compressed format (pluggable — filesystem default, can be disabled or custom-wired)
6. Exposes both a programmatic API and a CLI

v1 targets ORA error prefix only. Architecture supports TNS/PLS/RMAN expansion in v2.

### Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Output format default | TOON | 28% smaller than JSON on batch, self-describing headers, general-purpose (not Oracle-locked). Module is `webtollm` not `oracletollm` — TOON scales to future non-Oracle use. |
| Secondary formats | Markdown + JSON | Markdown for human-readable/SQL code blocks. JSON for programmatic consumers. Both are trivial formatters on the structured object. |
| Skip positional format v1 | Deferred | Positional's edge is abbreviation dictionaries (VC2, NUM, NN) which don't apply to prose-heavy error docs. TOON captures ~90% of savings. Add positional when expanding to schema/DDL content. |
| Extraction approach | Cheerio targeted selectors | DOM is known and consistent. Readability would lose structured content (parameters, code blocks). Cheerio is 10x lighter than JSDOM. |
| JS rendering | Not needed | Oracle docs are static HTML. No SPA/JS rendering required. |
| Embeddings | Not needed | Rule-based DOM extraction is proven and sufficient. No ML inference in a fetch-and-format tool. |
| Version handling | Latest release only (first `<section>`) | 90% of consumers want current docs. Multi-version parsing adds complexity. `{ release: '19c' }` option stubbed for v1.1. |
| Error prefix scope | ORA only, extensible pattern | User specified. Architecture uses `{prefix}-{code}` so TNS/PLS/RMAN drop in later. |
| Caching | Pluggable interface with filesystem default | API contract: `CacheProvider` interface. Default: gzip-compressed filesystem cache. Can be disabled or replaced with custom impl. |
| Runtime | Node.js only | Avoids CORS issues. Browser support deferred. |
| Dependencies | 2 production: `cheerio` + `@toon-format/toon` | cheerio: DOM parsing + CSS selectors (20 transitive, 11MB). toon: zero deps, 128KB. Native `fetch()` for HTTP — no axios/node-fetch. |

### Architecture

```
┌─────────────────────────────────────────────────────────┐
│  CLI (bin/webtollm.mjs)                                 │
│  npx webtollm ORA-00001 --format toon                   │
└──────────────────────┬──────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────┐
│  Public API (src/index.ts)                              │
│                                                         │
│  fetchError('ORA-00001') → OracleError                  │
│  fetchErrors(['ORA-00001','ORA-12154']) → OracleError[] │
│  listErrors() → ErrorIndex[]                            │
│  warm(opts?) → re-fetch stale cached entries             │
│  warmAll() → fetch + cache all ~3,500 ORA codes         │
└──────────┬──────────────────────────────┬───────────────┘
           │                              │
┌──────────▼──────────┐    ┌──────────────▼───────────────┐
│  Fetcher            │    │  Cache (src/cache.ts)         │
│  (src/fetcher.ts)   │    │                              │
│  HTTP GET with      │    │  interface CacheProvider {    │
│  retry + timeout    │    │    get(key): Promise<T|null> │
│  Rate limiting      │    │    set(key,val,ttl): void    │
│  (100ms between     │    │    has(key): Promise<bool>   │
│   batch requests)   │    │    clear(): void             │
│                     │    │  }                           │
│                     │    │                              │
│                     │    │  Default: FilesystemCache     │
│                     │    │  - ~/.webtollm/cache/        │
│                     │    │  - gzip-compressed JSON      │
│                     │    │  - TTL: 24h (configurable)   │
│                     │    │                              │
│                     │    │  Built-in: MemoryCache       │
│                     │    │  Disabled: cache: false      │
│                     │    │  Custom: user wires own impl │
│                     │    │                              │
│                     │    │  Storage format per entry:   │
│                     │    │  { data, fetchedAt, ttl }    │
│                     │    │  → gzip → ~/.webtollm/cache/ │
│                     │    │     ora-00001.json.gz        │
│                     │    │                              │
│                     │    │  warm(): re-fetch entries    │
│                     │    │    where now > fetchedAt+ttl │
│                     │    │  warmAll(): index → fetch    │
│                     │    │    all ~3,500 codes (5 conc) │
└──────────┬──────────┘    └──────────────────────────────┘
           │ raw HTML
┌──────────▼──────────────────────────────────────────────┐
│  Extractor (src/extractor.ts)                           │
│                                                         │
│  Cheerio-based targeted extraction:                     │
│  1. Load HTML into cheerio                              │
│  2. Select <main id="maincontent">                      │
│  3. Take FIRST <section> only (latest release)          │
│  4. Extract:                                            │
│     - <h2> → error code                                 │
│     - first <p> after h2 → message                      │
│     - <dl>/<ul.parameters> → parameter definitions      │
│     - <h3>Cause + siblings → cause text                 │
│     - <h3>Action + siblings → action text/list          │
│     - <h3>Additional Information + <pre><code> → info   │
│  5. Return structured OracleError object                │
│                                                         │
│  DISCARDS: header, footer, nav, breadcrumbs, scripts,   │
│  release selector, duplicate/legacy sections, skip links│
└──────────┬──────────────────────────────────────────────┘
           │ OracleError object
┌──────────▼──────────────────────────────────────────────┐
│  Formatters (src/formatters/)                           │
│                                                         │
│  toon.ts     → TOON via @toon-format/toon encode()     │
│  markdown.ts → Clean Markdown with fenced SQL blocks    │
│  json.ts     → JSON.stringify (pretty or compact)       │
│                                                         │
│  Each formatter: ~30-50 lines                           │
│  Shared OracleError interface drives all three          │
└─────────────────────────────────────────────────────────┘
```

### Data Model

```typescript
interface OracleError {
  code: string;            // "ORA-00001"
  message: string;         // "unique constraint (...) violated..."
  parameters: Parameter[]; // { name, description }[]
  cause: string;           // prose text
  action: string;          // prose text (may contain nested list structure)
  additionalInfo?: string; // optional prose
  sql?: string[];          // optional SQL examples
  release?: string;        // "26ai" | "21c" | "19c" (when detectable)
  url: string;             // source URL for attribution
}

interface Parameter {
  name: string;            // "constraint_schema"
  description: string;     // "The schema name where..."
}

interface ErrorIndex {
  code: string;            // "ORA-00001"
  url: string;             // full URL
}

interface CacheProvider {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttl?: number): Promise<void>;
  has(key: string): Promise<boolean>;
  clear(): Promise<void>;
  keys(): Promise<string[]>;   // needed for cache warming (enumerate stale entries)
}

interface WebtollmConfig {
  cache?: false | CacheProvider;  // false=disabled, undefined=FilesystemCache default
  cacheTtl?: number;              // default: 86400000 (24h)
  baseUrl?: string;               // default: 'https://docs.oracle.com/en/error-help/db/'
  timeout?: number;               // default: 10000 (10s)
}

// Per-call options
interface FetchOptions {
  format?: 'toon' | 'markdown' | 'json';  // default: 'toon'
  release?: string;        // default: latest (first section)
  noCache?: boolean;       // bypass cache for this call
}

// Cache warming — re-fetches and replaces stale entries
interface WarmOptions {
  codes?: string[];        // specific codes to warm (default: all cached entries)
  concurrency?: number;    // parallel fetches (default: 5)
  onProgress?: (done: number, total: number) => void;  // progress callback
}
// Usage:
//   client.warm()                          — refresh all cached entries
//   client.warm({ codes: ['ORA-00001'] })  — refresh specific codes
//   client.warmAll()                       — fetch + cache ALL ~3,500 ORA codes from index
```

### DOM Extraction Map

Source: `https://docs.oracle.com/en/error-help/db/ora-XXXXX/`

**Verified against raw HTML** (not AI-reconstructed). Validated on 8 real ORA pages.

```
<main class="err">                                ← entry point
  <div id="26ai" style="display: block;">         ← EXTRACT (latest release, display:block)
    <h2>ORA-XXXXX</h2>                            → code
    <div class="st">message with <var>params</var></div>  → message
    <div class="ca v">                             → parameters[] (optional)
      <ul><li><var>name</var>: description</li></ul>  → { name, description }
    </div>
    <hr>
    <h3>Cause</h3>
    <div class="ca"><p>cause text...</p></div>     → cause
    <hr>
    <h3>Action</h3>
    <div class="ca">                               → action
      <p>action text...</p>
      <ul><li>action steps...</li></ul>              (may contain mixed p + ul)
    </div>
    <hr>
    <h3>Additional Information</h3>                → additionalInfo (optional)
    <div class="t">
      <p>info text...</p>
      <pre><code>SQL...</code></pre>               → sql[] (optional, multiple)
    </div>
  </div>
  
  <div id="21c" style="display: none;">            ← SKIP (legacy, display:none)
  <div id="19c" style="display: none;">            ← SKIP (legacy, display:none)
</main>
```

**Key selector details:**
- Release version = `<div id>` attribute (e.g., `"26ai"`, `"21c"`, `"19c"`)
- Message div = `div.st` (contains `<var>` tags for parameter placeholders)
- Parameter div = `div.ca.v` (the `.v` class distinguishes it from cause/action `.ca` divs)
- Cause/Action content = `div.ca` after the `<h3>` heading
- Additional Info = `div.t` after the `<h3>Additional Information</h3>` heading
- SQL blocks = `<pre><code>` inside `div.t`

### Integration Points

| System | Protocol | Auth | Discovery Status |
|--------|----------|------|------------------|
| Oracle docs (error pages) | HTTPS GET | None (public) | Done — DOM verified on ORA-00001 and ORA-12154 |
| Oracle docs (index page) | HTTPS GET | None (public) | Done — ~3,500 ORA codes, single page, `<a href="ora-XXXXX/">` links |
| @toon-format/toon | npm import | N/A | Done — `encode()` tested on real error data |

### Config Surface

| Setting | Type | Source | Default |
|---------|------|--------|---------|
| format | `'toon' \| 'markdown' \| 'json'` | Per-call option / CLI flag | `'toon'` |
| cache | `false \| CacheProvider` | WebtollmConfig (constructor) | `FilesystemCache` (~/.webtollm/cache/, gzip) |
| cacheTtl | number (ms) | WebtollmConfig | `86400000` (24h) |
| timeout | number (ms) | WebtollmConfig | `10000` (10s) |
| release | string | Per-call option / CLI flag | `undefined` (latest) |
| baseUrl | string | WebtollmConfig | `https://docs.oracle.com/en/error-help/db/` |
| noCache | boolean | Per-call option / CLI flag | `false` |

### Error Handling

| Scenario | Behavior |
|----------|----------|
| Invalid error code format | Throw `InvalidCodeError` with expected pattern hint |
| HTTP 404 (code doesn't exist) | Throw `ErrorNotFoundError` with code and URL |
| HTTP timeout | Throw `FetchTimeoutError`, respect configured timeout |
| HTTP 429 (rate limited) | Retry with exponential backoff (max 3 attempts) |
| Network failure | Throw `NetworkError` wrapping original error |
| DOM structure changed (selectors miss) | Throw `ExtractionError` — "page structure may have changed" |
| Index page fetch fails | Throw `IndexFetchError` |
| Cache miss | Transparent — fetches live, populates cache |
| Cache stale (TTL expired) | Returns stale data + triggers background refresh. Never blocks on stale. |
| Cache warm failure (network) | Log warning, keep existing cached entry. Don't evict on failed refresh. |
| warmAll with no network | Throw `NetworkError` — can't warm without connectivity |

### Observability

- **Logging:** Optional debug logger (`debug` package or custom). Off by default. Logs: fetch URLs, cache hits/misses, extraction timing.
- **Metrics:** None in v1 (library, not service).
- **Health checks:** N/A (not a daemon).

### Testing Strategy

- **Archetype:** Infrastructure Tool (HTTP client + DOM parser)
- **Mock boundaries:** HTTP responses mocked with saved HTML fixtures (snapshot of real ORA-00001, ORA-12154 pages). Never hit live Oracle docs in tests.
- **Critical path:**
  1. Extractor: given known HTML → produces correct OracleError object (parameters, cause, action, SQL all extracted correctly)
  2. Formatters: given OracleError → produces valid TOON/Markdown/JSON
  3. Code normalization: `ORA-1` → `ora-00001`, `ora00001` → `ora-00001`
  4. Cache: filesystem read/write, gzip compression, TTL expiry, cache bypass, custom provider wiring
  5. Cache warming: warm() only re-fetches stale entries, warmAll() fetches from index, respects concurrency limit
  6. Error handling: 404, timeout, malformed HTML
- **Fixtures:** Save actual HTML from ORA-00001 (complex: params + SQL + additional info) and ORA-12154 (complex: nested action lists, multiple versions) as test fixtures.

### Output Examples

**Single error — TOON format:**
```toon
code: ORA-00001
message: unique constraint (constraint_schema.constraint_name) violated on table table_schema.table_name columns (column_names)
parameters[5]{name,description}:
  constraint_schema,The schema name where the constraint resides.
  constraint_name,The name of the constraint.
  table_schema,The schema name for the table affected by this constraint.
  table_name,The name of the table affected by this constraint.
  column_names,The column names affected by this constraint.
cause: "An UPDATE, INSERT or MERGE statement attempted to update or create a record that duplicated values limited by a unique constraint."
action: "Determine what type of unique constraint was violated (explicit unique constraint, unique index, or primary key)."
additionalInfo: Further details about the violating column values are provided with the parameter ERROR_MESSAGE_DETAILS=ON.
sql[2]:
  - "SELECT 'CONSTRAINT' object_type FROM all_constraints WHERE owner = '<schema_name>' AND constraint_name = '<constraint_name>';"
  - "SELECT column_name, table_name FROM all_cons_columns WHERE owner = '<schema_name>' AND constraint_name = '<constraint_name>';"
url: https://docs.oracle.com/en/error-help/db/ora-00001/
```

**Batch errors — TOON format:**
```toon
[5]{code,message,cause,action}:
  ORA-00001,unique constraint (string.string) violated,An UPDATE or INSERT statement attempted to insert a duplicate key.,Either remove the unique restriction or do not insert the key.
  ORA-00017,session requested to set trace event,The current session was requested to set a trace event by another session.,This is used internally; no action is required.
  ORA-00018,maximum number of sessions exceeded,All session state objects are in use.,Increase the value of the SESSIONS initialization parameter.
```

**Single error — Markdown format:**
```markdown
# ORA-00001

**unique constraint (constraint_schema.constraint_name) violated on table table_schema.table_name columns (column_names)**

## Parameters
- **constraint_schema:** The schema name where the constraint resides.
- **constraint_name:** The name of the constraint.

## Cause
An UPDATE, INSERT or MERGE statement attempted to update or create a record that duplicated values limited by a unique constraint.

## Action
Determine what type of unique constraint was violated (explicit unique constraint, unique index, or primary key).

## SQL Examples
\`\`\`sql
SELECT 'CONSTRAINT' object_type FROM all_constraints WHERE owner = '<schema_name>' AND constraint_name = '<constraint_name>';
\`\`\`

> Source: https://docs.oracle.com/en/error-help/db/ora-00001/
```

### CLI Interface

```bash
# Single error (default: TOON)
npx webtollm ORA-00001

# Specific format
npx webtollm ORA-00001 --format markdown
npx webtollm ORA-00001 --format json

# Batch
npx webtollm ORA-00001 ORA-12154 ORA-00020

# List all ORA codes
npx webtollm --list

# No cache
npx webtollm ORA-00001 --no-cache

# Warm cache — re-fetch all stale entries
npx webtollm --warm

# Warm specific codes
npx webtollm --warm ORA-00001 ORA-12154

# Warm ALL ~3,500 ORA codes (offline use)
npx webtollm --warm-all

# Pipe-friendly (no color, compact)
npx webtollm ORA-00001 --format json | jq .cause
```

### Scope

**In scope (v1):**
- Static worker: takes URL + descriptor, returns structured content
- Descriptor-driven cheerio extraction engine (zero site awareness in engine)
- Extraction types: `text`, `list`, `heading_section`, `nested_sections`, `repeating_group`, `link_list`, `code_blocks`
- Bundled descriptors: `oracle-error-docs.json`, `oracle-standard-docs.json`
- TOON, Markdown, and JSON output formats
- Pluggable cache with filesystem default (gzip-compressed, ~/.webtollm/cache/)
- Cache warming: refresh stale entries, warm-all for offline use
- Error code normalization (`ORA-1` → `ora-00001`) — convenience wrapper
- CLI with format/cache flags
- Targeted cheerio extraction (discard 85% boilerplate)
- HTTP retry with backoff on 429
- TypeScript with full type exports
- Dependencies: `cheerio` + `@toon-format/toon` + native `fetch()`

**Out of scope (v1):**
- Local knowledge DB (`.toon` curated database like `oracle-guide-db.toon` with RC/DIAG/FIX/HUNT enrichment)
- Knowledge DB update pipeline (web fetch → LLM distill → validate against live Oracle DB)
- Non-ORA prefixes (TNS, PLS, RMAN, ACFS)
- Multi-version/release selection
- Positional pipe-delimited format
- Browser/CORS support
- SQLite cache backend (filesystem gzip is v1)
- JS-rendered page support
- Crawling (follow links between error pages)
- PDF extraction
- Authentication/cookies
- Embeddings or ML-based extraction
- Rate limiting configuration (hardcoded 100ms between batch requests)
- Proxy support

**Phase 2 — Knowledge DB:**
- Local knowledge DB layer — `.toon` file as primary data source, web fetch as fallback
  - Format: curated entries with `RC:`, `FLEET:`, `DIAG:`, `FIX:` fields (richer than raw docs)
  - Currently 31 ORA codes + 12 hunt patterns (~14.5K tokens vs ~93K from web for same codes)
  - Lookup flow: `check local DB → found? serve → not found? web fetch → optionally append to DB`
  - Fully offline capable when DB covers the needed codes
- Knowledge DB update pipeline:
  - Tier 1 (automated): webtollm fetches Oracle docs → extracts baseline Cause/Action
  - Tier 2 (LLM-assisted): coding agent distills verbose docs into concise RC:/FIX:, adds DIAG queries from V$ view docs, enriches with FLEET context
  - Tier 3 (validation): Oracle MCP validates DIAG queries run on live instance, confirms V$ columns exist
- MS Win32 system error codes descriptor — validated in mock (244 codes, 82% reduction)
- Python descriptor generator script (`tools/generate-descriptor.py`)
- Additional error prefixes (TNS, PLS, RMAN)
- Release/version selection (`{ release: '19c' }`)

**Phase 3 candidates:**
- General web page extraction (beyond Oracle docs)
- Positional format with abbreviation dictionary
- Browser support via bundled cache or proxy
- Community-contributed descriptor registry

### Validation Results (mock-validate.mjs)

Mock application tested against 8 live ORA pages: ORA-00001, ORA-00018, ORA-00020, ORA-01017, ORA-12154, ORA-00054, ORA-01403, ORA-06512.

**Extraction accuracy: 8/8 PASS** — all key fields (code, message, cause, action) populated. Parameters, SQL, and additional info extracted where present.

**Token savings (8 errors combined):**

| Format | Tokens | vs Raw HTML | vs JSON |
|--------|--------|-------------|---------|
| Raw HTML (baseline) | 92,281 | — | — |
| JSON (structured) | 3,843 | 96% less | — |
| TOON (structured) | 3,206 | 97% less | 17% less |
| Markdown (prose) | 3,088 | 97% less | 20% less |

**Batch encoding (8 errors, tabular TOON):** 30% fewer tokens than JSON pretty.

**Cache gzip compression:** 45.2% average reduction, all round-trips lossless.

**Key finding:** For individual prose-heavy errors, Markdown edges out TOON by ~4%. TOON wins on batch (tabular format) and provides structured parseability. Both achieve 97% reduction vs raw HTML — the extraction itself is the dominant win, not the output format.

**Oracle Standard Docs (SQL Reference, product docs):**

| Page | Raw HTML | Markdown | Reduction |
|------|----------|----------|-----------|
| SQL Ref: SELECT | 207,747 | 54,235 | 74% |
| SQL Ref: CREATE TABLE | 308,100 | 65,481 | 79% |
| SQL Ref: Changes 21c | 15,109 | 431 | 97% |
| Exadata Overview | 3,348 | 211 | 94% (hub page, links only) |
| **TOTAL** | **534,304** | **120,358** | **77%** |

**Microsoft Win32 Error Codes:** 244 codes extracted, 82% reduction vs HTML, 64% TOON vs JSON.

**Three descriptors, three DOM patterns, one generic engine.**

Full reports: `Docs/validation-report.json`

### Open Items

| Item | Status | Blocking |
|------|--------|----------|
| Oracle robots.txt / rate-limit policy | NEEDS DISCOVERY | No — we rate-limit conservatively (100ms gap). But should verify before publishing to npm. |
| Exact CSS selectors for all section variants | DONE | Verified on 8 real pages. Selectors: `main.err`, `div.st`, `div.ca.v`, `div.ca`, `div.t`, `pre code`. See DOM Extraction Map. |
| Release label extraction from sections | DONE | Release = `<div id>` attribute (e.g., `"26ai"`, `"21c"`). Latest has `display:block`, legacy has `display:none`. |
| npm package name availability (`webtollm`) | NEEDS CHECK | No — can rename if taken. |
