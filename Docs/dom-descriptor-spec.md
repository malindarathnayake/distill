## DOM Descriptor Specification

### Purpose

A DOM Descriptor is a declarative JSON file that tells the webtollm engine how to parse a specific website's pages. Instead of hardcoding CSS selectors, each site gets its own descriptor. The core extractor becomes a generic engine driven by descriptors.

Descriptors can be:
- **Bundled** with the module (e.g., `oracle-error-docs.json` ships with webtollm)
- **User-provided** at runtime (`config.descriptors: [...]`)
- **Generated** by a Python script using a coding agent (analyzes DOM, outputs descriptor)
- **Updated out of band** without touching module code

### Descriptor Schema

```jsonc
{
  // ── Identity ────────────────────────────────────────────
  "name": "oracle-error-docs",
  "version": "1.0.0",
  "description": "Oracle Database error documentation pages",

  // ── URL Matching ────────────────────────────────────────
  // How the engine knows this descriptor applies to a given URL.
  // Supports glob patterns and named captures.
  "url_pattern": "https://docs.oracle.com/en/error-help/db/{prefix}-{code}/",

  // Optional: index page URL for listing all items
  "index": {
    "url": "https://docs.oracle.com/en/error-help/db/ora-index.html",
    "item_selector": "a[href^='ora-']",
    "item_extract": {
      "code": { "source": "text" },
      "url": { "source": "attr", "attr": "href" }
    }
  },

  // ── Page Structure ──────────────────────────────────────
  // Entry point into the page content
  "root": "main.err",

  // Section selection — how to pick the right content block
  // within root. Supports: "first", "css", "attr_match"
  "section": {
    "strategy": "css",
    "selector": "div[style*='display: block']",
    // Fallback if primary selector fails
    "fallback": "div:first-child"
  },

  // ── Field Extraction ────────────────────────────────────
  // Each field maps a name to an extraction rule.
  // The extractor walks these in order, building the output object.
  "fields": {
    "code": {
      "selector": "h2",
      "extract": "text",
      "required": true
    },

    "message": {
      "selector": "div.st",
      "extract": "text",
      "required": true,
      // Clean up: remove <var> tags but keep their text
      "strip_tags": ["var"]
    },

    "parameters": {
      "selector": "div.ca.v ul > li",
      "extract": "list",
      "required": false,
      // Each list item is parsed into a sub-object
      "item_fields": {
        "name": {
          "selector": "var",
          "extract": "text"
        },
        "description": {
          "extract": "text_after",
          "after": "var",
          "trim_prefix": ":"
        }
      }
    },

    "cause": {
      "extract": "heading_section",
      "heading": "Cause",
      "heading_tag": "h3",
      "content_selector": "div.ca",
      "content_extract": "prose",
      "required": true
    },

    "action": {
      "extract": "heading_section",
      "heading": "Action",
      "heading_tag": "h3",
      "content_selector": "div.ca",
      "content_extract": "prose",
      "required": true
    },

    "additionalInfo": {
      "extract": "heading_section",
      "heading": "Additional Information",
      "heading_tag": "h3",
      "content_selector": "div.t",
      "content_extract": "prose",
      "required": false
    },

    "sql": {
      "extract": "heading_section",
      "heading": "Additional Information",
      "heading_tag": "h3",
      "content_selector": "div.t",
      "content_extract": "code_blocks",
      "code_selector": "pre code",
      "required": false
    }
  },

  // ── Metadata Extraction ─────────────────────────────────
  // Fields derived from structural attributes, not content
  "metadata": {
    "release": {
      "source": "section_attr",
      "attr": "id"
    },
    "url": {
      "source": "input_url"
    }
  },

  // ── Prose Extraction Rules ──────────────────────────────
  // How "prose" content_extract works
  "prose_rules": {
    "paragraph_selector": "p",
    "list_selector": "ul > li, ol > li",
    "list_prefix": "- ",
    "join": "\n",
    "trim": true
  },

  // ── Cleanup Rules ───────────────────────────────────────
  // Elements to remove before extraction
  "cleanup": {
    "remove_selectors": [
      "script",
      "style",
      "nav",
      "header",
      "footer",
      ".release-selector"
    ]
  }
}
```

### Extraction Types

| Type | Description | Output |
|------|-------------|--------|
| `text` | Inner text of matched element, trimmed | `string` |
| `html` | Inner HTML of matched element | `string` |
| `attr` | Attribute value of matched element | `string` |
| `text_after` | Text content after a child element | `string` |
| `list` | Iterate matched elements, extract per `item_fields` | `object[]` |
| `prose` | Extract `<p>` text + `<li>` items from container, joined | `string` |
| `code_blocks` | Extract `<pre><code>` text from container | `string[]` |
| `heading_section` | Find `<hN>` by text, then extract from next sibling | varies |
| `table` | Extract `<table>` rows into objects (future) | `object[]` |

### Selector Strategies

| Strategy | Description |
|----------|-------------|
| `css` | Standard CSS selector |
| `first` | First direct child of root |
| `attr_match` | Match by attribute value (e.g., `style*='display: block'`) |
| `nth` | Nth child (0-indexed) |
| `heading_next` | Find heading element by text, take next sibling |

### Field Modifiers

| Modifier | Description | Example |
|----------|-------------|---------|
| `required` | Fail extraction if field is empty | `true` / `false` |
| `strip_tags` | Remove specific HTML tags but keep text | `["var", "code"]` |
| `trim_prefix` | Remove prefix from extracted text | `":"` |
| `trim_suffix` | Remove suffix from extracted text | `"."` |
| `regex` | Apply regex to extracted text | `"ORA-\\d+"` |
| `default` | Default value if extraction fails | `""` |
| `transform` | Post-extraction transform | `"uppercase"`, `"lowercase"`, `"trim"` |

### Descriptor Resolution Order

When the engine receives a URL, it resolves the descriptor:

1. **Exact match** — user-provided descriptor with matching `url_pattern`
2. **Bundled match** — built-in descriptors that ship with the module
3. **Fallback** — generic Readability-style extraction (future, Phase 2)

```typescript
// API: custom descriptor
const client = new Webtollm({
  descriptors: [
    './my-descriptors/confluence-pages.json',
    './my-descriptors/aws-docs.json',
  ]
});

// Or inline
const client = new Webtollm({
  descriptors: [myDescriptorObject]
});
```

### Bundled Descriptors (v1)

| Descriptor | URL Pattern | Extraction Types | Ships With |
|------------|-------------|-----------------|------------|
| `oracle-error-docs` | `docs.oracle.com/en/error-help/db/{prefix}-{code}/` | heading_section, list, text | v1 |
| `oracle-standard-docs` | `docs.oracle.com/en/{database,engineered-systems}/.../*.html` | nested_sections, link_list, text | v1 |

### Python Generator Script

A companion Python script (`tools/generate-descriptor.py`) that a coding agent can use to create or update descriptors. It:

1. **Fetches** the target page (with optional Playwright for JS-rendered)
2. **Analyzes** DOM structure:
   - Identifies `<main>`, `<article>`, or high-content-density containers
   - Detects repeating patterns (lists, tables, heading+content pairs)
   - Identifies boilerplate (nav, footer, sidebar) by tag semantics and frequency
   - Detects parameter/variable patterns (`<var>`, `<code>`, definition lists)
3. **Generates** a draft descriptor JSON
4. **Validates** by extracting from N sample pages and checking field coverage

```bash
# Generate descriptor from a sample URL
python tools/generate-descriptor.py \
  --url "https://docs.oracle.com/en/error-help/db/ora-00001/" \
  --name "oracle-error-docs" \
  --samples "ora-00001,ora-12154,ora-00054" \
  --output descriptors/oracle-error-docs.json

# Validate existing descriptor against live pages
python tools/generate-descriptor.py \
  --validate descriptors/oracle-error-docs.json \
  --samples "ora-00001,ora-12154,ora-00054,ora-01017"

# Update descriptor (re-analyze DOM, keep field names, update selectors)
python tools/generate-descriptor.py \
  --update descriptors/oracle-error-docs.json \
  --url "https://docs.oracle.com/en/error-help/db/ora-00001/"
```

#### Generator Architecture

```
┌─────────────────────────────────────────────────────┐
│  generate-descriptor.py                             │
│                                                     │
│  1. Fetch page (requests or playwright)             │
│  2. Parse with BeautifulSoup                        │
│  3. Analyze DOM:                                    │
│     a. Find content root (main, article, #content)  │
│     b. Detect sections (heading + content pairs)    │
│     c. Detect lists (ul/ol with consistent items)   │
│     d. Detect parameters (var, dt/dd, strong+text)  │
│     e. Detect code blocks (pre > code)              │
│     f. Detect boilerplate (nav, footer, sidebar)    │
│  4. Generate descriptor JSON                        │
│  5. Validate on N sample URLs                       │
│  6. Output with confidence scores per field         │
└─────────────────────────────────────────────────────┘
```

#### Validation Output

```json
{
  "descriptor": "oracle-error-docs",
  "samples_tested": 4,
  "field_coverage": {
    "code": { "found": 4, "total": 4, "confidence": 1.0 },
    "message": { "found": 4, "total": 4, "confidence": 1.0 },
    "parameters": { "found": 2, "total": 4, "confidence": 0.5, "note": "Only present on some errors" },
    "cause": { "found": 4, "total": 4, "confidence": 1.0 },
    "action": { "found": 4, "total": 4, "confidence": 1.0 },
    "sql": { "found": 2, "total": 4, "confidence": 0.5, "note": "Optional field" }
  },
  "selector_stability": "STABLE",
  "warnings": []
}
```

### Descriptor Versioning

Descriptors include a `version` field. When Oracle (or any site) changes their DOM:

1. Python script detects selector failures on validation
2. Generates updated descriptor with new version
3. Old descriptor stays in the module for fallback
4. Users can pin descriptor versions: `{ descriptorVersion: '1.0.0' }`

### How This Enables General Web Support

The descriptor system is how webtollm goes from "Oracle error tool" to "any website":

1. **v1:** Ships with `oracle-error-docs.json`. That's the only bundled descriptor.
2. **v1.x:** Users create custom descriptors for their sites (Confluence, AWS docs, MDN, etc.)
3. **v2:** Python generator makes descriptor creation semi-automatic.
4. **v3:** Community-contributed descriptor registry (npm package or GitHub repo of descriptors).
5. **Future:** LLM-assisted descriptor generation — feed the HTML to an LLM, get a descriptor back.
