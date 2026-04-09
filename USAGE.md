# Usage Guide

## CLI Reference

```
Usage: distill [options] [codes...]

Options:
  --format <toon|markdown|json>  Output format (default: toon)
  --no-cache                     Bypass cache for this request
  --list                         List all available ORA error codes
  --warm                         Re-fetch stale cache entries
  --warm-all                     Fetch all ~3,500 ORA codes
  --help, -h                     Show help
```

### Single Error Lookup

```bash
distill ORA-00001
distill ORA-00001 --format json
distill ORA-00001 --format markdown
```

Short forms and case variations are normalized automatically:

```bash
distill ORA-1       # normalizes to ORA-00001
distill ora00001    # normalizes to ORA-00001
distill ORA-12154   # works as-is
```

### Batch Lookup

```bash
distill ORA-00001 ORA-12154 ORA-00060
distill ORA-00001 ORA-12154 --format json
```

Batch requests are rate-limited (100ms between calls) to avoid overwhelming the source.

### List All Codes

```bash
distill --list
```

Outputs tab-separated `code\turl` lines. Pipe to other tools:

```bash
distill --list | head -20
distill --list | grep "ORA-01"
distill --list | wc -l
```

### Cache Warming

```bash
# Re-fetch only stale entries
distill --warm

# Warm specific codes
distill --warm ORA-00001 ORA-12154

# Fetch all ~3,500 codes (takes a few minutes)
distill --warm-all
```

Progress is printed to stderr so it doesn't interfere with piped output.

### Piping

Output goes to stdout, errors and progress to stderr. Safe to pipe:

```bash
# Pipe to clipboard
distill ORA-00001 --format markdown | pbcopy

# Pipe to file
distill ORA-00001 --format json > ora-00001.json

# Pipe to jq
distill ORA-00001 --format json | jq '.cause'

# Feed into an LLM CLI
distill ORA-00001 | llm "explain this error and suggest fixes"
```

## Node.js API

### Basic Usage

```typescript
import Distill from 'distill';

const client = new Distill();

// Single error
const error = await client.fetchError('ORA-00001');
console.log(error.code);       // "ORA-00001"
console.log(error.message);    // "unique constraint ... violated"
console.log(error.cause);      // "An UPDATE, INSERT or MERGE..."
console.log(error.action);     // "Determine what type of..."
console.log(error.parameters); // [{ name: "constraint_name", description: "..." }, ...]
console.log(error.sql);        // ["SELECT ...", "SELECT ..."]
console.log(error.url);        // "https://docs.oracle.com/en/error-help/db/ora-00001/"
```

### Batch Lookup

```typescript
const errors = await client.fetchErrors(['ORA-00001', 'ORA-12154', 'ORA-00060']);
// Rate-limited: 100ms between each request
```

### Formatting

```typescript
import { format } from 'distill';

const error = await client.fetchError('ORA-00001');

const toon = format(error, 'toon');         // compact TOON format
const md = format(error, 'markdown');        // human-readable Markdown
const json = format(error, 'json');          // JSON string

// Batch formatting
const errors = await client.fetchErrors(['ORA-00001', 'ORA-12154']);
const batchToon = format(errors, 'toon');    // tabular TOON
const batchJson = format(errors, 'json');    // JSON array
```

### Generic URL Extraction

Extract structured content from any URL that matches a loaded descriptor:

```typescript
const data = await client.extract('https://docs.oracle.com/en/error-help/db/ora-00001/');
// Returns Record<string, unknown> with extracted fields
```

Throws `ExtractionError` if no descriptor matches the URL.

### List Available Codes

```typescript
const index = await client.listErrors();
// [{ code: "ORA-00001", url: "https://..." }, { code: "ORA-00002", url: "..." }, ...]
```

### Cache Warming

```typescript
// Warm specific codes
await client.warm({ codes: ['ORA-00001', 'ORA-12154'] });

// Warm stale entries
await client.warm();

// Warm with progress tracking
await client.warm({
  codes: ['ORA-00001', 'ORA-12154', 'ORA-00060'],
  concurrency: 10,
  onProgress: (done, total) => {
    console.log(`${done}/${total}`);
  }
});

// Warm all ~3,500 codes
await client.warmAll();
```

## Configuration

```typescript
import Distill, { MemoryCache } from 'distill';

const client = new Distill({
  // Cache: false to disable, CacheProvider instance, or omit for default filesystem cache
  cache: new MemoryCache(),          // in-memory (good for serverless/tests)
  // cache: false,                   // disable caching entirely

  // Cache TTL in milliseconds (default: 86400000 = 24 hours)
  cacheTtl: 3600000,                 // 1 hour

  // Request timeout in milliseconds (default: 10000)
  timeout: 15000,

  // Base URL for Oracle docs (default: Oracle's official docs site)
  baseUrl: 'https://docs.oracle.com/en/error-help/db/',

  // Additional descriptor files
  descriptors: ['./my-custom-descriptor.json'],

  // Debug logging to console
  debug: true,
});
```

## Custom Descriptors

The extraction engine is generic. You can add support for any documentation site by writing a JSON descriptor — either by hand or with the built-in generator.

### Generating a Descriptor

The fastest way to create a new descriptor is to point the generator at a sample page:

```bash
# Analyze a page and print draft descriptor to stdout
npm run create-descriptor -- https://docs.example.com/errors/ERR-001/

# Save directly to a file with a custom name
npm run create-descriptor -- https://docs.example.com/errors/ERR-001/ \
  --name my-errors --out descriptors/my-errors.json

# Verbose mode — see full DOM analysis
npm run create-descriptor -- https://docs.example.com/errors/ERR-001/ --verbose

# Override the detected root element
npm run create-descriptor -- https://docs.example.com/errors/ERR-001/ --root "article.main"
```

The generator:
1. Fetches the page and strips scripts/styles
2. Auto-detects the content root (`main`, `article`, `#content`, etc.)
3. Maps headings to `heading_section` extraction fields
4. Identifies lists, tables, code blocks, and repeating DOM patterns
5. Derives `url_pattern` and `base_url` from the URL
6. Outputs a draft JSON with `_preview` hints explaining each detected field

The output is a **starting point**. After generating:
1. Remove `_preview` fields (they're analysis hints, not part of the descriptor spec)
2. Refine CSS selectors to be more precise for your target pages
3. Set `required: true` on fields that must always be present
4. Adjust `url_pattern` to match all pages in the series (not just the sample)
5. Test against multiple pages to verify extraction accuracy

### Descriptor Structure

```json
{
  "name": "my-docs",
  "version": "1.0",
  "description": "My documentation source",
  "url_pattern": "https://docs.example.com/errors/{code}/",
  "base_url": "https://docs.example.com/errors/",
  "root": "main.content",
  "fields": {
    "title": {
      "selector": "h1",
      "extract": "text"
    },
    "description": {
      "selector": ".description",
      "extract": "text"
    },
    "solution": {
      "heading": "Solution",
      "heading_tag": "h2",
      "content_selector": ".section-body",
      "extract": "heading_section",
      "content_extract": "prose"
    }
  },
  "metadata": {
    "url": {
      "source": "input_url"
    }
  }
}
```

### Extraction Types

| Type | Description | Key Fields |
|------|-------------|------------|
| `text` | Direct text from a CSS selector | `selector` |
| `attr` | HTML attribute value | `selector`, `attr` |
| `list` | Repeated items with sub-fields | `selector`, `item_fields` |
| `heading_section` | Content following a heading match | `heading`, `heading_tag`, `content_selector` |
| `nested_sections` | Recursive section extraction | `section_selectors`, `heading_selectors` |
| `repeating_group` | Sibling-offset groups | `group_anchor`, `group_size`, `item_fields` |
| `link_list` | Links with text and href | `selector` |

### Loading Custom Descriptors

```typescript
// From file path
const client = new Distill({
  descriptors: ['./descriptors/my-docs.json']
});

// As inline object
const client = new Distill({
  descriptors: [{
    name: 'my-docs',
    url_pattern: 'https://docs.example.com/errors/{code}/',
    // ...
  }]
});
```

User descriptors take priority over bundled ones (first match wins).

### End-to-End Workflow: Adding a New Source

```bash
# 1. Generate a draft descriptor from a sample page
npm run create-descriptor -- https://docs.example.com/errors/ERR-001/ \
  --name example-errors --out descriptors/example-errors.json --verbose

# 2. Review and refine the generated JSON
#    - Remove _preview fields
#    - Tighten CSS selectors
#    - Set required: true on key fields
#    - Fix url_pattern to match all pages (e.g., {code} placeholder)

# 3. Test extraction with the CLI
node dist/cli.js --format json https://docs.example.com/errors/ERR-001/

# 4. Load it in your code
```

```typescript
import Distill from 'distill';

const client = new Distill({
  descriptors: ['./descriptors/example-errors.json']
});

const data = await client.extract('https://docs.example.com/errors/ERR-042/');
console.log(data); // extracted fields from your descriptor
```

## Error Handling

All errors extend `DistillError` and include contextual information:

```typescript
import {
  InvalidCodeError,     // bad error code format
  ErrorNotFoundError,   // 404 — code doesn't exist
  FetchTimeoutError,    // request timed out
  NetworkError,         // DNS failure, connection refused, etc.
  ExtractionError,      // extraction failed or no descriptor match
  IndexFetchError,      // failed to fetch the error index
} from 'distill';

try {
  const error = await client.fetchError('ORA-00001');
} catch (err) {
  if (err instanceof ErrorNotFoundError) {
    console.log(`${err.errorCode} not found at ${err.url}`);
  } else if (err instanceof FetchTimeoutError) {
    console.log(`Timed out after ${err.timeoutMs}ms`);
  }
}
```

## Security

### Untrusted Content

Extracted content comes from external web pages. Treat it as untrusted data:

- **Do not eval or execute** extracted content
- **Fence LLM injections** — wrap extracted text in explicit data boundaries before injecting into prompts:

```typescript
const error = await client.fetchError('ORA-00001');
const context = format(error, 'toon');

const prompt = `
<extracted-data source="oracle-docs" trust="external">
${context}
</extracted-data>

Based on the error documentation above, explain why this error occurred.
`;
```

- **Validate before acting** — if using extracted content to make decisions (e.g., automated remediation), verify the content matches expected patterns
- **Be aware of caching** — cached content reflects the page state at fetch time, not necessarily the current state

### Rate Limiting

The tool rate-limits requests (100ms between sequential calls) to be respectful to source servers. Cache warming processes codes in configurable concurrent batches (default: 5).

## TypeScript Types

All types are exported for TypeScript consumers:

```typescript
import type {
  OracleError,      // extracted error object
  ErrorIndex,       // { code, url } from list
  DistillConfig,   // constructor options
  FetchOptions,     // per-request options
  WarmOptions,      // cache warming options
  FormatType,       // 'toon' | 'markdown' | 'json'
  CacheProvider,    // cache interface for custom implementations
  Descriptor,       // extraction descriptor schema
  Parameter,        // { name, description }
} from 'distill';
```
