#!/usr/bin/env node

/**
 * Descriptor Generator — analyzes a web page and generates a draft descriptor JSON.
 *
 * Usage:
 *   node scripts/create-descriptor.mjs <url> [--name my-docs] [--out descriptors/my-docs.json]
 *
 * What it does:
 *   1. Fetches the page
 *   2. Analyzes the DOM structure (headings, sections, repeated patterns)
 *   3. Identifies potential extractable fields
 *   4. Generates a draft descriptor.json
 *
 * The output is a STARTING POINT — you'll need to refine selectors and
 * extraction types based on what fields you actually want.
 */

import * as cheerio from 'cheerio';
import { writeFileSync } from 'fs';

// ── Arg parsing ──────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
  console.log(`
Descriptor Generator — create a draft extraction descriptor from a web page.

Usage:
  node scripts/create-descriptor.mjs <url> [options]

Options:
  --name <name>     Descriptor name (default: derived from URL hostname)
  --out <path>      Output file path (default: stdout)
  --root <selector> Override root selector (default: auto-detected)
  --verbose         Show analysis details

Examples:
  node scripts/create-descriptor.mjs https://docs.example.com/errors/ERR-001/
  node scripts/create-descriptor.mjs https://docs.example.com/errors/ERR-001/ --name my-errors --out descriptors/my-errors.json
  node scripts/create-descriptor.mjs https://docs.oracle.com/en/error-help/db/ora-00001/ --verbose
`);
  process.exit(0);
}

let url = '';
let name = '';
let outPath = '';
let rootOverride = '';
let verbose = false;

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--name') { name = args[++i]; }
  else if (arg === '--out') { outPath = args[++i]; }
  else if (arg === '--root') { rootOverride = args[++i]; }
  else if (arg === '--verbose') { verbose = true; }
  else if (!arg.startsWith('-')) { url = arg; }
}

if (!url) {
  console.error('Error: URL is required.');
  process.exit(1);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function log(...msg) {
  if (verbose) console.error('[analyze]', ...msg);
}

function deriveNameFromUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/\./g, '-').replace(/^www-/, '');
  } catch {
    return 'my-docs';
  }
}

function deriveUrlPattern(url) {
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.split('/').filter(Boolean);
    // Replace the last segment (likely the specific page ID) with a placeholder
    if (segments.length > 0) {
      const lastSegment = segments[segments.length - 1];
      // If it looks like a code/id (has numbers or dashes), make it a placeholder
      if (/[\d-]/.test(lastSegment)) {
        segments[segments.length - 1] = '{code}';
      }
    }
    return `${parsed.origin}/${segments.join('/')}/`;
  } catch {
    return url;
  }
}

function deriveBaseUrl(url) {
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.split('/').filter(Boolean);
    if (segments.length > 1) {
      segments.pop(); // remove last segment
      return `${parsed.origin}/${segments.join('/')}/`;
    }
    return `${parsed.origin}/`;
  } catch {
    return url;
  }
}

// ── DOM Analysis ─────────────────────────────────────────────────────────────

function analyzeStructure($) {
  const analysis = {
    title: null,
    headings: [],
    sections: [],
    lists: [],
    tables: [],
    codeBlocks: [],
    links: [],
    repeatingPatterns: [],
    bestRoot: 'body',
  };

  // Find the best root element (main content area)
  const rootCandidates = [
    'main', 'article', '[role="main"]', '.content', '#content',
    '.main-content', '#main-content', '.article-body', '.doc-content',
    '.page-content', '#doc-content',
  ];

  for (const sel of rootCandidates) {
    if ($(sel).length > 0) {
      analysis.bestRoot = sel;
      log(`Root candidate: ${sel} (${$(sel).children().length} children)`);
      break;
    }
  }

  const root = $(analysis.bestRoot);

  // Title: first h1
  const h1 = root.find('h1').first();
  if (h1.length) {
    analysis.title = {
      selector: buildSelector($, h1),
      text: h1.text().trim().slice(0, 80),
    };
    log(`Title: "${analysis.title.text}" via ${analysis.title.selector}`);
  }

  // Headings: all h2-h4 as potential section markers
  root.find('h2, h3, h4').each((_i, el) => {
    const $el = $(el);
    const text = $el.text().trim();
    if (text && text.length < 100) {
      analysis.headings.push({
        tag: el.tagName,
        text,
        selector: buildSelector($, $el),
      });
    }
  });
  log(`Found ${analysis.headings.length} headings`);

  // Sections: divs/sections with class names
  root.find('section, div[class]').each((_i, el) => {
    const $el = $(el);
    const classes = $el.attr('class') || '';
    const children = $el.children().length;
    if (children > 0 && children < 50 && classes) {
      const textLen = $el.text().trim().length;
      if (textLen > 20 && textLen < 5000) {
        analysis.sections.push({
          selector: el.tagName + '.' + classes.split(/\s+/)[0],
          classes,
          childCount: children,
          textLength: textLen,
          preview: $el.text().trim().slice(0, 60),
        });
      }
    }
  });
  log(`Found ${analysis.sections.length} content sections`);

  // Lists
  root.find('ul, ol, dl').each((_i, el) => {
    const $el = $(el);
    const items = $el.children('li, dt, dd').length;
    if (items > 0) {
      analysis.lists.push({
        tag: el.tagName,
        items,
        selector: buildSelector($, $el),
        preview: $el.text().trim().slice(0, 60),
      });
    }
  });
  log(`Found ${analysis.lists.length} lists`);

  // Tables
  root.find('table').each((_i, el) => {
    const $el = $(el);
    const rows = $el.find('tr').length;
    const headers = $el.find('th').map((_j, th) => $(th).text().trim()).get();
    analysis.tables.push({
      rows,
      headers,
      selector: buildSelector($, $el),
    });
  });
  log(`Found ${analysis.tables.length} tables`);

  // Code blocks
  root.find('pre, code').each((_i, el) => {
    const $el = $(el);
    const text = $el.text().trim();
    if (text.length > 10) {
      analysis.codeBlocks.push({
        tag: el.tagName,
        selector: buildSelector($, $el),
        preview: text.slice(0, 60),
      });
    }
  });
  log(`Found ${analysis.codeBlocks.length} code blocks`);

  // Detect repeating patterns (same tag+class appearing 3+ times)
  const classCounts = {};
  root.find('[class]').each((_i, el) => {
    const key = `${el.tagName}.${($(el).attr('class') || '').split(/\s+/)[0]}`;
    classCounts[key] = (classCounts[key] || 0) + 1;
  });
  for (const [sel, count] of Object.entries(classCounts)) {
    if (count >= 3) {
      analysis.repeatingPatterns.push({ selector: sel, count });
    }
  }
  log(`Found ${analysis.repeatingPatterns.length} repeating patterns`);

  return analysis;
}

function buildSelector($, $el) {
  const el = $el[0];
  if (!el) return '';

  const tag = el.tagName;
  const id = $el.attr('id');
  if (id) return `${tag}#${id}`;

  const cls = $el.attr('class');
  if (cls) return `${tag}.${cls.split(/\s+/)[0]}`;

  return tag;
}

// ── Descriptor Generation ────────────────────────────────────────────────────

function generateDescriptor(analysis, url, descriptorName) {
  const descriptor = {
    name: descriptorName,
    version: '1.0',
    description: `Extraction descriptor for ${descriptorName} — DRAFT, needs refinement`,
    url_pattern: deriveUrlPattern(url),
    base_url: deriveBaseUrl(url),
    root: analysis.bestRoot,
    fields: {},
    metadata: {
      url: { source: 'input_url' },
    },
  };

  // Add cleanup for common noise elements
  descriptor.cleanup = {
    remove_selectors: [
      'nav', 'header', 'footer', '.sidebar', '.breadcrumb',
      '.nav', 'script', 'style', '.cookie-banner',
    ],
  };

  // Title field
  if (analysis.title) {
    descriptor.fields.title = {
      selector: analysis.title.selector,
      extract: 'text',
      required: true,
      _preview: analysis.title.text,
    };
  }

  // Heading-based sections → heading_section fields
  for (const h of analysis.headings) {
    const fieldName = h.text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, '_')
      .slice(0, 30);

    if (fieldName && !descriptor.fields[fieldName]) {
      descriptor.fields[fieldName] = {
        heading: h.text,
        heading_tag: h.tag,
        content_selector: 'div, p, section',
        extract: 'heading_section',
        content_extract: 'prose',
        _preview: `Content under "${h.text}" heading`,
      };
    }
  }

  // Lists → list fields
  for (let i = 0; i < analysis.lists.length && i < 3; i++) {
    const list = analysis.lists[i];
    const fieldName = `list_${i + 1}`;
    descriptor.fields[fieldName] = {
      selector: `${list.selector} > li`,
      extract: 'list',
      item_fields: {
        text: { extract: 'text' },
      },
      _preview: `${list.items} items: "${list.preview}"`,
    };
  }

  // Code blocks
  if (analysis.codeBlocks.length > 0) {
    descriptor.fields.code_examples = {
      heading: 'Example',
      heading_tag: 'h2, h3',
      content_selector: 'pre, code',
      extract: 'heading_section',
      content_extract: 'code_blocks',
      code_selector: 'pre code, pre',
      _preview: `${analysis.codeBlocks.length} code blocks found`,
    };
  }

  // Tables
  for (let i = 0; i < analysis.tables.length && i < 2; i++) {
    const table = analysis.tables[i];
    const fieldName = table.headers.length > 0
      ? table.headers[0].toLowerCase().replace(/\s+/g, '_').slice(0, 20) + '_table'
      : `table_${i + 1}`;
    descriptor.fields[fieldName] = {
      selector: `${table.selector} tr`,
      extract: 'list',
      item_fields: {
        cells: { selector: 'td', extract: 'text' },
      },
      _preview: `${table.rows} rows, headers: ${table.headers.join(', ') || 'none'}`,
    };
  }

  // Repeating patterns
  for (const pattern of analysis.repeatingPatterns.slice(0, 3)) {
    const fieldName = pattern.selector
      .replace(/[^a-z0-9]/gi, '_')
      .toLowerCase()
      .slice(0, 25) + '_items';
    if (!descriptor.fields[fieldName]) {
      descriptor.fields[fieldName] = {
        selector: pattern.selector,
        extract: 'list',
        item_fields: {
          text: { extract: 'text' },
        },
        _preview: `${pattern.count} repeating elements`,
      };
    }
  }

  return descriptor;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const descriptorName = name || deriveNameFromUrl(url);

  console.error(`Fetching ${url}...`);
  const response = await fetch(url);
  if (!response.ok) {
    console.error(`Error: HTTP ${response.status} from ${url}`);
    process.exit(1);
  }
  const html = await response.text();
  console.error(`Received ${html.length} bytes. Analyzing DOM...`);

  const $ = cheerio.load(html);

  // Strip scripts/styles before analysis
  $('script, style, noscript').remove();

  const analysis = analyzeStructure($);

  console.error(`\nAnalysis:`);
  console.error(`  Root:       ${rootOverride || analysis.bestRoot}`);
  console.error(`  Title:      ${analysis.title?.text || '(none)'}`);
  console.error(`  Headings:   ${analysis.headings.length}`);
  console.error(`  Sections:   ${analysis.sections.length}`);
  console.error(`  Lists:      ${analysis.lists.length}`);
  console.error(`  Tables:     ${analysis.tables.length}`);
  console.error(`  Code blocks: ${analysis.codeBlocks.length}`);
  console.error(`  Repeating:  ${analysis.repeatingPatterns.length}`);

  if (verbose) {
    console.error(`\nHeadings found:`);
    for (const h of analysis.headings) {
      console.error(`  <${h.tag}> "${h.text}"`);
    }
    if (analysis.sections.length > 0) {
      console.error(`\nTop sections:`);
      for (const s of analysis.sections.slice(0, 10)) {
        console.error(`  ${s.selector} (${s.childCount} children, ${s.textLength} chars): "${s.preview}"`);
      }
    }
    if (analysis.repeatingPatterns.length > 0) {
      console.error(`\nRepeating patterns:`);
      for (const p of analysis.repeatingPatterns) {
        console.error(`  ${p.selector} x${p.count}`);
      }
    }
  }

  if (rootOverride) {
    analysis.bestRoot = rootOverride;
  }

  const descriptor = generateDescriptor(analysis, url, descriptorName);

  // Clean up _preview fields for the output (they're hints, not part of the spec)
  const output = JSON.stringify(descriptor, null, 2);

  console.error(`\nGenerated descriptor with ${Object.keys(descriptor.fields).length} fields.`);
  console.error(`\nIMPORTANT: This is a DRAFT. You should:`);
  console.error(`  1. Remove _preview fields (they're analysis hints)`);
  console.error(`  2. Refine selectors to match your target pages precisely`);
  console.error(`  3. Set 'required: true' on fields that must be present`);
  console.error(`  4. Adjust url_pattern to match all pages in the series`);
  console.error(`  5. Test with: node dist/cli.js --format json <url>`);

  if (outPath) {
    writeFileSync(outPath, output + '\n');
    console.error(`\nWritten to ${outPath}`);
  } else {
    console.error(`\n--- Descriptor JSON ---\n`);
    process.stdout.write(output + '\n');
  }
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
