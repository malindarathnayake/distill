<p align="center">
  <img src="Docs/BN2.jpg" alt="distill logo" height="80" />
</p>

<h1 align="center">distill</h1>

A descriptor-driven web content extraction tool that turns documentation pages into structured, LLM-ready context. Extracts the signal from web pages — stripping navigation chrome, scripts, and boilerplate — and outputs clean data in TOON, Markdown, or JSON formats.

Ships with Oracle error docs support. Adding new sources is a JSON descriptor file, not new code.

## Why

When you need Oracle error documentation in a prompt, pasting the raw HTML page wastes ~97% of your context window on noise. This tool extracts just the structured content — error code, message, cause, action, SQL examples — and outputs it in a format dense enough to inject directly into an LLM prompt, pipe into another tool, or read in a terminal.

## Install

### From GitHub Release (recommended)

Download the latest tarball from [Releases](https://github.com/malindarathnayake/distill/releases) and install directly:

```bash
# One-liner: download and install latest release
curl -sL https://github.com/malindarathnayake/distill/releases/latest/download/distill-1.0.0.tgz | npm install -g -

# Or download first, then install
curl -sLO https://github.com/malindarathnayake/distill/releases/latest/download/distill-1.0.0.tgz
npm install -g distill-1.0.0.tgz

# Or install as a project dependency from the tarball URL
npm install https://github.com/malindarathnayake/distill/releases/latest/download/distill-1.0.0.tgz
```

### From source

```bash
git clone https://github.com/malindarathnayake/distill.git
cd distill
npm install && npx tsc
npm link  # makes 'distill' available globally
```

## Quick Start

### CLI

```bash
# Look up an error (default: TOON format)
npx distill ORA-00001

# Markdown for human reading
npx distill ORA-00001 --format markdown

# JSON for programmatic use
npx distill ORA-00001 --format json

# Batch lookup
npx distill ORA-00001 ORA-12154 ORA-00060

# List all available ORA codes
npx distill --list

# Pre-fetch everything for offline use
npx distill --warm-all
```

### Node.js API

```typescript
import Distill from 'distill';

const client = new Distill();

// Structured object
const error = await client.fetchError('ORA-00001');
console.log(error.code);    // "ORA-00001"
console.log(error.cause);   // "An UPDATE, INSERT or MERGE statement..."
console.log(error.action);  // "Determine what type of unique constraint..."

// Formatted string for LLM injection
import { format } from 'distill';
const context = format(error, 'toon');
```

## Output Formats

### TOON (default)

Compact, self-describing format optimized for LLM context windows. ~17% smaller than JSON on batch operations.

```
code: ORA-00001
message: unique constraint violated
parameters[2]{name,description}:
  constraint_name,The name of the constraint.
  table_name,The name of the table.
cause: "An UPDATE or INSERT statement attempted to insert a duplicate key."
action: "Remove the unique restriction or do not insert the key."
url: "https://docs.oracle.com/en/error-help/db/ora-00001/"
```

### Markdown

Human-readable with headers, lists, and fenced SQL blocks.

```markdown
# ORA-00001

**unique constraint violated**

## Cause
An UPDATE or INSERT statement attempted to insert a duplicate key.

## Action
Remove the unique restriction or do not insert the key.

> Source: https://docs.oracle.com/en/error-help/db/ora-00001/
```

### JSON

Standard JSON for programmatic consumption. Supports pretty-printing.

```json
{
  "code": "ORA-00001",
  "message": "unique constraint violated",
  "cause": "An UPDATE or INSERT statement attempted to insert a duplicate key.",
  "action": "Remove the unique restriction or do not insert the key.",
  "url": "https://docs.oracle.com/en/error-help/db/ora-00001/"
}
```

## Caching

Results are cached locally (gzip-compressed) with a 24-hour TTL by default.

- **Fresh cache hit** — instant, no network request
- **Stale cache hit** — returns stale data immediately, refreshes in the background
- **Cache miss** — fetches from source, caches the result
- **`--no-cache`** — bypasses cache read, still caches the result

```bash
# Pre-warm specific codes
npx distill --warm ORA-00001 ORA-12154

# Pre-warm all ~3,500 ORA codes for offline use
npx distill --warm-all
```

## Descriptor System

Extraction rules are defined in JSON descriptor files, not hardcoded. Each descriptor maps a URL pattern to CSS selectors and extraction strategies.

```json
{
  "name": "oracle-error-docs",
  "url_pattern": "https://docs.oracle.com/en/error-help/db/{prefix}-{code}/",
  "fields": {
    "message": { "selector": "h2.errm", "extract": "text" },
    "cause": { "heading": "Cause", "extract": "heading_section", "content_extract": "prose" }
  }
}
```

Bundled descriptors:
- `oracle-error-docs.json` — Oracle Database error codes (ORA-xxxxx)
- `oracle-standard-docs.json` — Oracle standard documentation pages

### Creating New Descriptors

A helper script analyzes any web page and generates a draft descriptor:

```bash
# Analyze a page and print draft descriptor
npm run create-descriptor -- https://docs.example.com/errors/ERR-001/

# With a custom name and output file
npm run create-descriptor -- https://docs.example.com/errors/ERR-001/ \
  --name my-errors --out descriptors/my-errors.json

# Verbose mode — shows DOM analysis details
npm run create-descriptor -- https://docs.example.com/errors/ERR-001/ --verbose
```

The script fetches the page, identifies the content root, headings, sections, lists, tables, code blocks, and repeating patterns — then outputs a draft JSON descriptor. Review the output, refine the selectors, and remove `_preview` hint fields before use.

### Loading Custom Descriptors

```typescript
const client = new Distill({
  descriptors: ['./descriptors/my-errors.json']
});
```

## Security Considerations

Extracted content is **untrusted external data**. When injecting into LLM prompts:

- Fence extracted content with clear data boundaries (e.g., XML tags)
- Do not treat extracted text as instructions
- Be aware that page content could change between fetches
- The descriptor's `url_pattern` constrains which URLs are matched, but `extract()` accepts arbitrary URLs

See [USAGE.md](USAGE.md) for detailed security guidance.

## API Reference

See [USAGE.md](USAGE.md) for full API documentation, configuration options, and examples.

## License

ISC
