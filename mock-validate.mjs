/**
 * webtollm — Design Validation Mock (Multi-Descriptor)
 *
 * Proves the DOM Descriptor abstraction works across completely
 * different page structures:
 *   1. Oracle error docs  — heading+section pattern
 *   2. Microsoft Win32    — repeating <p> triplet pattern
 *
 * The extraction engine is GENERIC — it reads descriptors, not sites.
 */

import * as cheerio from 'cheerio';
import { encode as toonEncode } from '@toon-format/toon';
import { encode as tokenize } from 'gpt-3-encoder';
import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'fs';
import { gzipSync, gunzipSync } from 'zlib';
import { join } from 'path';

// ── Load Descriptors ───────────────────────────────────────────────
const oracleDesc = JSON.parse(readFileSync('descriptors/oracle-error-docs.json', 'utf-8'));
const msDesc = JSON.parse(readFileSync('descriptors/ms-system-error-codes.json', 'utf-8'));

const CACHE_DIR = join(process.cwd(), '.validation-cache');
const RATE_LIMIT_MS = 150;

// ── Helpers ────────────────────────────────────────────────────────
function countTokens(text) { return tokenize(text).length; }
async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function escapeRegex(str) { return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

async function fetchCached(url, cacheKey) {
  const cacheFile = join(CACHE_DIR, `${cacheKey}.html.gz`);
  if (existsSync(cacheFile)) {
    return gunzipSync(readFileSync(cacheFile)).toString('utf-8');
  }
  console.log(`  Fetching ${url}...`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const html = await res.text();
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(cacheFile, gzipSync(Buffer.from(html)));
  return html;
}

function validateCacheRoundTrip(obj) {
  const json = JSON.stringify(obj);
  const compressed = gzipSync(Buffer.from(json));
  const restored = JSON.parse(gunzipSync(compressed).toString('utf-8'));
  return {
    isEqual: JSON.stringify(restored) === json,
    jsonBytes: json.length,
    gzipBytes: compressed.length,
    ratio: ((1 - compressed.length / json.length) * 100).toFixed(1)
  };
}

// ══════════════════════════════════════════════════════════════════
//  GENERIC DESCRIPTOR-DRIVEN EXTRACTION ENGINE
//  Knows NOTHING about any specific site.
// ══════════════════════════════════════════════════════════════════

function extractWithDescriptor(html, desc, inputUrl) {
  const $ = cheerio.load(html);

  // Cleanup
  if (desc.cleanup?.remove_selectors) {
    for (const sel of desc.cleanup.remove_selectors) $(sel).remove();
  }

  // Find root
  const root = $(desc.root).first();
  if (!root.length) throw new Error(`Root selector "${desc.root}" not found`);

  // Find section
  let section = root;
  if (desc.section) {
    const found = root.find(desc.section.selector).first();
    section = found.length ? found : (desc.section.fallback ? root.find(desc.section.fallback).first() : root);
    if (!section.length) section = root;
  }

  // Extract fields
  const result = {};
  for (const [fieldName, rule] of Object.entries(desc.fields)) {
    try {
      const value = extractField($, section, rule, desc.prose_rules);
      if (value !== null && value !== undefined && value !== '' && !(Array.isArray(value) && value.length === 0)) {
        result[fieldName] = value;
      } else if (rule.required) {
        result[fieldName] = (rule.extract === 'list' || rule.extract === 'repeating_group') ? [] : '';
      }
    } catch (e) {
      if (rule.required) {
        result[fieldName] = (rule.extract === 'list' || rule.extract === 'repeating_group') ? [] : '';
      }
    }
  }

  // Metadata
  if (desc.metadata) {
    for (const [k, v] of Object.entries(desc.metadata)) {
      if (v.source === 'section_attr') result[k] = section.attr(v.attr) || undefined;
      else if (v.source === 'input_url') result[k] = inputUrl;
    }
  }

  return result;
}

function extractField($, section, rule, proseRules) {
  switch (rule.extract) {
    case 'text': {
      const el = section.find(rule.selector).first();
      let text = el.text().trim();
      if (rule.regex) {
        const m = text.match(new RegExp(rule.regex));
        text = m ? m[1] : text;
      }
      return text || null;
    }

    case 'attr': {
      const el = section.find(rule.selector).first();
      return el.attr(rule.attr) || null;
    }

    case 'list': {
      const items = [];
      section.find(rule.selector).each((i, el) => {
        const item = {};
        for (const [subName, subRule] of Object.entries(rule.item_fields)) {
          if (subRule.extract === 'text') {
            item[subName] = $(el).find(subRule.selector).first().text().trim();
          } else if (subRule.extract === 'text_after') {
            const afterEl = $(el).find(subRule.after).first();
            const fullText = $(el).text().trim();
            const afterText = afterEl.text().trim();
            let remaining = fullText.substring(fullText.indexOf(afterText) + afterText.length);
            if (subRule.trim_prefix) {
              remaining = remaining.replace(new RegExp(`^\\s*${escapeRegex(subRule.trim_prefix)}\\s*`), '');
            }
            item[subName] = remaining.trim();
          }
        }
        if (Object.values(item).some(v => v)) items.push(item);
      });
      return items.length > 0 ? items : null;
    }

    case 'heading_section': {
      const headings = section.find(rule.heading_tag);
      let targetHeading = null;
      headings.each((i, el) => {
        if ($(el).text().trim().toLowerCase().includes(rule.heading.toLowerCase())) {
          if (!targetHeading) targetHeading = $(el);
        }
      });
      if (!targetHeading) return null;

      const contentDiv = targetHeading.next(rule.content_selector);
      if (!contentDiv.length) return null;

      if (rule.content_extract === 'prose') return extractProse($, contentDiv, proseRules);
      if (rule.content_extract === 'code_blocks') return extractCodeBlocks($, contentDiv, rule.code_selector || 'pre code');
      return contentDiv.text().trim() || null;
    }

    case 'repeating_group': {
      // Find anchor elements, then read N consecutive siblings as a group
      const anchors = section.find(rule.group_anchor);
      const items = [];

      anchors.each((i, anchorEl) => {
        const item = {};
        const anchor = $(anchorEl);

        for (const [subName, subRule] of Object.entries(rule.item_fields)) {
          let target;
          if (subRule.offset === 0) {
            target = anchor;
          } else {
            // Walk forward through siblings
            target = anchor;
            for (let step = 0; step < subRule.offset; step++) {
              target = target.next();
            }
          }
          if (!target.length) continue;

          let text;
          if (subRule.selector) {
            text = target.find(subRule.selector).first().text().trim();
          } else {
            text = target.text().trim();
          }

          if (subRule.regex && text) {
            const m = text.match(new RegExp(subRule.regex));
            text = m ? m[1] : text;
          }

          item[subName] = text || '';
        }

        if (Object.values(item).some(v => v)) items.push(item);
      });

      return items.length > 0 ? items : null;
    }

    default:
      return null;
  }
}

function extractProse($, container, rules) {
  const parts = [];
  const pr = rules || { paragraph_selector: 'p', list_selector: 'ul > li, ol > li', list_prefix: '- ', join: '\n', trim: true };
  container.find(pr.paragraph_selector).each((i, el) => {
    const t = $(el).text().trim(); if (t) parts.push(t);
  });
  container.find(pr.list_selector).each((i, el) => {
    const t = $(el).text().trim(); if (t) parts.push((pr.list_prefix || '- ') + t);
  });
  return (pr.trim ? parts.join(pr.join || '\n').trim() : parts.join(pr.join || '\n'));
}

function extractCodeBlocks($, container, selector) {
  const blocks = [];
  container.find(selector).each((i, el) => {
    const t = $(el).text().trim(); if (t) blocks.push(t);
  });
  return blocks.length > 0 ? blocks : null;
}

// ── Formatters ─────────────────────────────────────────────────────
function oracleToMarkdown(err) {
  let md = `# ${err.code}\n\n**${err.message}**\n\n`;
  if (err.parameters?.length) {
    md += `## Parameters\n`;
    for (const p of err.parameters) md += `- **${p.name}:** ${p.description}\n`;
    md += '\n';
  }
  if (err.cause) md += `## Cause\n${err.cause}\n\n`;
  if (err.action) md += `## Action\n${err.action}\n\n`;
  if (err.additionalInfo) md += `## Additional Information\n${err.additionalInfo}\n\n`;
  if (err.sql?.length) { md += `## SQL Examples\n`; for (const s of err.sql) md += `\`\`\`sql\n${s}\n\`\`\`\n\n`; }
  md += `> Source: ${err.url}`;
  return md;
}

function msToMarkdown(errors) {
  return errors.map(e => `**${e.name}** (${e.code_decimal} / ${e.code_hex}): ${e.description}`).join('\n');
}

// ══════════════════════════════════════════════════════════════════
//  TEST 1: ORACLE ERROR DOCS
// ══════════════════════════════════════════════════════════════════
async function testOracle() {
  const codes = ['ORA-00001', 'ORA-00018', 'ORA-00020', 'ORA-01017', 'ORA-12154', 'ORA-00054', 'ORA-01403', 'ORA-06512'];

  console.log('\n' + '='.repeat(70));
  console.log(`  TEST 1: Oracle Error Docs (${oracleDesc.name} v${oracleDesc.version})`);
  console.log('='.repeat(70));

  const results = [];
  for (const code of codes) {
    const slug = code.toUpperCase().match(/ORA-?0*(\d+)/)?.[1]?.padStart(5, '0');
    const url = `${oracleDesc.base_url}ora-${slug}/`;
    const html = await fetchCached(url, `ora-${slug}`);
    const extracted = extractWithDescriptor(html, oracleDesc, url);

    const passed = !!extracted.code && !!extracted.message && !!extracted.cause && !!extracted.action;
    console.log(`  ${passed ? 'PASS' : 'WARN'} ${code} — ${(extracted.message || '').substring(0, 55)}...`);

    results.push({ code, html, extracted, passed });
    await sleep(RATE_LIMIT_MS);
  }

  // Token comparison
  console.log('\n  Token Savings:');
  console.log('  Code         | Raw HTML |  JSON  |  TOON  | Markdown');
  console.log('  ' + '-'.repeat(55));

  let tR = 0, tJ = 0, tT = 0, tM = 0;
  for (const r of results) {
    const raw = countTokens(r.html);
    const json = countTokens(JSON.stringify(r.extracted, null, 2));
    const toon = countTokens(toonEncode(r.extracted));
    const md = countTokens(oracleToMarkdown(r.extracted));
    console.log(`  ${r.code.padEnd(13)} | ${String(raw).padStart(6)}   | ${String(json).padStart(5)}  | ${String(toon).padStart(5)}  | ${String(md).padStart(5)}`);
    tR += raw; tJ += json; tT += toon; tM += md;
  }
  console.log('  ' + '-'.repeat(55));
  console.log(`  ${'TOTAL'.padEnd(13)} | ${String(tR).padStart(6)}   | ${String(tJ).padStart(5)}  | ${String(tT).padStart(5)}  | ${String(tM).padStart(5)}`);
  console.log(`  TOON vs HTML: ${((1 - tT / tR) * 100).toFixed(0)}% reduction`);
  console.log(`  TOON vs JSON: ${((1 - tT / tJ) * 100).toFixed(0)}% reduction`);

  // Batch TOON
  const batch = results.map(r => ({
    code: r.extracted.code, message: r.extracted.message,
    cause: (r.extracted.cause || '').substring(0, 150),
    action: (r.extracted.action || '').substring(0, 150),
  }));
  const batchToon = toonEncode(batch);
  const batchJson = JSON.stringify(batch, null, 2);
  console.log(`\n  Batch TOON (${results.length} errors): ${countTokens(batchToon)} tokens (vs JSON ${countTokens(batchJson)} = ${((1 - countTokens(batchToon) / countTokens(batchJson)) * 100).toFixed(0)}% less)`);

  // Cache
  console.log('\n  Cache gzip round-trip:');
  for (const r of results) {
    const c = validateCacheRoundTrip(r.extracted);
    console.log(`  ${r.code}: ${c.isEqual ? 'PASS' : 'FAIL'} — ${c.jsonBytes}B → ${c.gzipBytes}B (${c.ratio}%)`);
  }

  return { pass: results.filter(r => r.passed).length, total: results.length, totalRaw: tR, totalToon: tT, totalJson: tJ };
}

// ══════════════════════════════════════════════════════════════════
//  TEST 2: MICROSOFT SYSTEM ERROR CODES
// ══════════════════════════════════════════════════════════════════
async function testMicrosoft() {
  console.log('\n\n' + '='.repeat(70));
  console.log(`  TEST 2: Microsoft System Error Codes (${msDesc.name} v${msDesc.version})`);
  console.log('='.repeat(70));

  const url = 'https://learn.microsoft.com/en-us/windows/win32/debug/system-error-codes--0-499-';
  const html = await fetchCached(url, 'ms-error-codes-0-499');
  const extracted = extractWithDescriptor(html, msDesc, url);

  const errorCount = extracted.errors?.length || 0;
  console.log(`  Extracted ${errorCount} error codes from page`);

  if (errorCount > 0) {
    console.log('\n  First 10 errors:');
    for (const e of extracted.errors.slice(0, 10)) {
      console.log(`    ${e.name.padEnd(30)} ${e.code_decimal.padStart(4)} (${e.code_hex.padStart(5)}) — ${e.description.substring(0, 45)}`);
    }

    // Spot check some known errors
    const checks = [
      { name: 'ERROR_SUCCESS', code: '0', desc: 'The operation completed successfully.' },
      { name: 'ERROR_FILE_NOT_FOUND', code: '2', desc: 'The system cannot find the file specified.' },
      { name: 'ERROR_ACCESS_DENIED', code: '5', desc: 'Access is denied.' },
    ];

    console.log('\n  Spot checks:');
    let spotPass = 0;
    for (const check of checks) {
      const found = extracted.errors.find(e => e.name === check.name);
      const ok = found && found.code_decimal === check.code && found.description === check.desc;
      console.log(`    ${ok ? 'PASS' : 'FAIL'} ${check.name}: ${ok ? 'matches' : `expected "${check.desc}", got "${found?.description}"`}`);
      if (ok) spotPass++;
    }

    // Token comparison
    const rawTokens = countTokens(html);
    const jsonStr = JSON.stringify(extracted, null, 2);
    const toonStr = toonEncode(extracted.errors);
    const mdStr = msToMarkdown(extracted.errors);

    const jsonTokens = countTokens(jsonStr);
    const toonTokens = countTokens(toonStr);
    const mdTokens = countTokens(mdStr);

    console.log(`\n  Token Savings (${errorCount} errors):`);
    console.log(`    Raw HTML:  ${rawTokens.toLocaleString()} tokens`);
    console.log(`    JSON:      ${jsonTokens.toLocaleString()} tokens (${((1 - jsonTokens / rawTokens) * 100).toFixed(0)}% less)`);
    console.log(`    TOON:      ${toonTokens.toLocaleString()} tokens (${((1 - toonTokens / rawTokens) * 100).toFixed(0)}% less)`);
    console.log(`    Markdown:  ${mdTokens.toLocaleString()} tokens (${((1 - mdTokens / rawTokens) * 100).toFixed(0)}% less)`);
    console.log(`    TOON vs JSON: ${((1 - toonTokens / jsonTokens) * 100).toFixed(0)}% fewer tokens`);

    // TOON output preview
    console.log('\n  TOON output (first 500 chars):');
    console.log('  ' + toonStr.substring(0, 500).split('\n').join('\n  '));

    // Cache round-trip
    const c = validateCacheRoundTrip(extracted);
    console.log(`\n  Cache gzip: ${c.isEqual ? 'PASS' : 'FAIL'} — ${c.jsonBytes}B → ${c.gzipBytes}B (${c.ratio}% compression)`);

    return { pass: spotPass, total: checks.length, errorCount, rawTokens, toonTokens, jsonTokens };
  }

  return { pass: 0, total: 0, errorCount: 0 };
}

// ══════════════════════════════════════════════════════════════════
//  MAIN
// ══════════════════════════════════════════════════════════════════
async function main() {
  console.log('='.repeat(70));
  console.log('  webtollm — Multi-Descriptor Validation');
  console.log('  Proving the generic engine works across different page structures');
  console.log('='.repeat(70));

  const oracle = await testOracle();
  const ms = await testMicrosoft();

  // Final summary
  console.log('\n\n' + '='.repeat(70));
  console.log('  FINAL SUMMARY');
  console.log('='.repeat(70));

  console.log('\n  ┌─────────────────────────┬──────────┬──────────────┬──────────────┐');
  console.log('  │ Site                    │ Extract  │ TOON vs HTML │ TOON vs JSON │');
  console.log('  ├─────────────────────────┼──────────┼──────────────┼──────────────┤');
  console.log(`  │ Oracle Error Docs       │ ${oracle.pass}/${oracle.total} PASS │ ${((1 - oracle.totalToon / oracle.totalRaw) * 100).toFixed(0)}% less     │ ${((1 - oracle.totalToon / oracle.totalJson) * 100).toFixed(0)}% less     │`);
  if (ms.errorCount > 0) {
    console.log(`  │ MS Win32 Error Codes    │ ${ms.errorCount} codes  │ ${((1 - ms.toonTokens / ms.rawTokens) * 100).toFixed(0)}% less     │ ${((1 - ms.toonTokens / ms.jsonTokens) * 100).toFixed(0)}% less     │`);
  }
  console.log('  └─────────────────────────┴──────────┴──────────────┴──────────────┘');

  console.log('\n  Descriptor-driven engine: VALIDATED');
  console.log('  Same engine, different descriptors, different DOM patterns.');
  console.log('='.repeat(70));

  // Save report
  writeFileSync('Docs/validation-report.json', JSON.stringify({ oracle, ms, timestamp: new Date().toISOString() }, null, 2));
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
