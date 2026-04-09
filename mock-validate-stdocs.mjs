/**
 * webtollm — Oracle Standard Docs Descriptor Validation
 *
 * Tests the nested_sections extraction type against real Oracle
 * documentation pages (SQL Reference, product docs).
 */

import * as cheerio from 'cheerio';
import { encode as toonEncode } from '@toon-format/toon';
import { encode as tokenize } from 'gpt-3-encoder';
import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'fs';
import { gzipSync, gunzipSync } from 'zlib';
import { join } from 'path';

const descriptor = JSON.parse(readFileSync('descriptors/oracle-standard-docs.json', 'utf-8'));
const CACHE_DIR = join(process.cwd(), '.validation-cache');

function countTokens(text) { return tokenize(text).length; }

async function fetchCached(url, cacheKey) {
  const cacheFile = join(CACHE_DIR, `${cacheKey}.html.gz`);
  if (existsSync(cacheFile)) {
    return gunzipSync(readFileSync(cacheFile)).toString('utf-8');
  }
  console.log(`  Fetching ${url}...`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(cacheFile, gzipSync(Buffer.from(html)));
  return html;
}

// ══════════════════════════════════════════════════════════════════
//  EXTRACTION ENGINE — with nested_sections support
// ══════════════════════════════════════════════════════════════════

function extractWithDescriptor(html, desc, inputUrl) {
  const $ = cheerio.load(html);

  if (desc.cleanup?.remove_selectors) {
    for (const sel of desc.cleanup.remove_selectors) $(sel).remove();
  }

  const root = $(desc.root).first();
  if (!root.length) throw new Error(`Root "${desc.root}" not found`);

  let section = root;
  if (desc.section) {
    const found = root.find(desc.section.selector).first();
    section = found.length ? found : root;
  }

  const result = {};

  for (const [fieldName, rule] of Object.entries(desc.fields)) {
    // Title lives at article level, not inside div.ind — search root first
    const searchContext = (fieldName === 'title') ? root : section;
    const value = extractField($, searchContext, rule, desc);
    if (value !== null && value !== undefined && value !== '' &&
        !(Array.isArray(value) && value.length === 0)) {
      result[fieldName] = value;
    }
  }

  if (desc.metadata) {
    for (const [k, v] of Object.entries(desc.metadata)) {
      if (v.source === 'input_url') result[k] = inputUrl;
      else if (v.source === 'first_match_attr') {
        const el = root.find(v.selector).first();
        result[k] = el.length ? el.attr(v.attr) : undefined;
      }
    }
  }

  return result;
}

function extractField($, section, rule, desc) {
  switch (rule.extract) {
    case 'text': {
      const el = section.find(rule.selector).first();
      return el.text().trim() || null;
    }

    case 'link_list': {
      const links = [];
      section.find(rule.selector).each((i, el) => {
        const text = $(el).text().trim();
        const href = $(el).attr('href');
        if (text && href) links.push({ text, href });
      });
      return links.length > 0 ? links : null;
    }

    case 'nested_sections': {
      return extractNestedSections($, section, rule, desc.prose_rules, 0);
    }

    default:
      return null;
  }
}

function extractNestedSections($, container, rule, proseRules, depth) {
  if (depth > (rule.max_depth || 3)) return null;

  const sections = [];
  const headingSelectors = rule.heading_selectors.join(', ');
  const sectionSelectors = rule.section_selectors.join(', ');

  // Strategy: find direct child sections, or find headings and collect content
  const childSections = container.children(sectionSelectors);

  if (childSections.length > 0) {
    childSections.each((i, sectionEl) => {
      const sec = $(sectionEl);
      const sectionObj = extractSectionContent($, sec, rule, proseRules, depth);
      if (sectionObj && (sectionObj.heading || sectionObj.content || sectionObj.subsections?.length)) {
        sections.push(sectionObj);
      }
    });
  } else {
    // Flat structure — find headings and collect following content
    const headings = container.find(headingSelectors);
    headings.each((i, hEl) => {
      const heading = $(hEl).text().trim();
      if (!heading) return;

      // Collect content between this heading and the next
      const content = [];
      let next = $(hEl).next();
      while (next.length && !next.is(headingSelectors)) {
        if (next.is('p')) {
          const t = next.text().trim();
          if (t) content.push(t);
        } else if (next.is('ul, ol')) {
          next.find('> li').each((j, li) => {
            content.push('- ' + $(li).text().trim());
          });
        } else if (next.is('pre')) {
          const code = next.find('code').text().trim() || next.text().trim();
          if (code) content.push('```sql\n' + code + '\n```');
        }
        next = next.next();
      }

      if (heading || content.length) {
        sections.push({ heading, content: content.join('\n') });
      }
    });
  }

  return sections.length > 0 ? sections : null;
}

function extractSectionContent($, sec, rule, proseRules, depth) {
  // Find heading
  const headingSelectors = rule.heading_selectors.join(', ');
  const headingEl = sec.find(headingSelectors).first();
  const heading = headingEl.length ? headingEl.text().trim() : '';

  // Extract prose content (paragraphs not used as headings)
  const proseSelector = proseRules?.paragraph_selector || 'p';
  const contentParts = [];

  sec.find(`> ${proseSelector}, > div > ${proseSelector}`).each((i, el) => {
    // Skip if this is a heading element
    if ($(el).is(headingSelectors)) return;
    const t = $(el).text().trim();
    if (t && t.length > 5) contentParts.push(t);
  });

  // Extract lists
  sec.find('> ul > li, > div > ul > li, > ol > li, > div > ol > li').each((i, el) => {
    const t = $(el).text().trim();
    if (t) contentParts.push('- ' + t);
  });

  // Extract code blocks
  const codeBlocks = [];
  const codeSel = rule.code_selector || 'pre code';
  sec.find(codeSel).each((i, el) => {
    const code = $(el).text().trim();
    if (code) {
      codeBlocks.push(code);
      contentParts.push('```\n' + code + '\n```');
    }
  });

  // Extract tables
  const tables = [];
  const tableSel = rule.table_selector || 'table';
  sec.find(tableSel).each((i, tableEl) => {
    const table = extractTable($, $(tableEl));
    if (table) tables.push(table);
  });

  // Recurse into subsections
  const subsections = extractNestedSections($, sec, rule, proseRules, depth + 1);

  const content = contentParts.join('\n');

  if (!heading && !content && !subsections?.length && !tables.length) return null;

  const result = { heading };
  if (content) result.content = content;
  if (codeBlocks.length) result.code = codeBlocks;
  if (tables.length) result.tables = tables;
  if (subsections?.length) result.subsections = subsections;

  return result;
}

function extractTable($, table) {
  const headers = [];
  table.find('thead th').each((i, th) => {
    headers.push($(th).text().trim());
  });

  const rows = [];
  table.find('tbody tr').each((i, tr) => {
    const row = {};
    $(tr).find('td').each((j, td) => {
      const key = headers[j] || `col_${j}`;
      row[key] = $(td).text().trim();
    });
    if (Object.values(row).some(v => v)) rows.push(row);
  });

  return rows.length > 0 ? { headers, rows } : null;
}

// ── Formatters ─────────────────────────────────────────────────────
function sectionsToMarkdown(doc, depth = 1) {
  let md = `${'#'.repeat(depth)} ${doc.title || 'Untitled'}\n\n`;

  if (doc.sections) {
    for (const sec of doc.sections) {
      if (sec.heading) md += `${'#'.repeat(depth + 1)} ${sec.heading}\n\n`;
      if (sec.content) md += sec.content + '\n\n';
      if (sec.tables) {
        for (const table of sec.tables) {
          if (table.headers?.length) {
            md += '| ' + table.headers.join(' | ') + ' |\n';
            md += '| ' + table.headers.map(() => '---').join(' | ') + ' |\n';
            for (const row of table.rows.slice(0, 10)) {
              md += '| ' + table.headers.map(h => row[h] || '').join(' | ') + ' |\n';
            }
            if (table.rows.length > 10) md += `\n_(${table.rows.length - 10} more rows)_\n`;
            md += '\n';
          }
        }
      }
      if (sec.subsections) {
        for (const sub of sec.subsections) {
          if (sub.heading) md += `${'#'.repeat(depth + 2)} ${sub.heading}\n\n`;
          if (sub.content) md += sub.content + '\n\n';
        }
      }
    }
  }

  if (doc.child_links?.length) {
    md += `${'#'.repeat(depth + 1)} Related Topics\n`;
    for (const link of doc.child_links) {
      md += `- [${link.text}](${link.href})\n`;
    }
  }

  return md;
}

// ── Main ───────────────────────────────────────────────────────────
async function main() {
  console.log('='.repeat(70));
  console.log('  webtollm — Oracle Standard Docs Validation');
  console.log(`  Descriptor: ${descriptor.name} v${descriptor.version}`);
  console.log('='.repeat(70));

  const testPages = [
    {
      name: 'SQL Ref: Changes in 21c',
      url: 'https://docs.oracle.com/en/database/oracle/oracle-database/21/sqlrf/Changes-in-This-Release-for-Oracle-Database-SQL-Language-Reference.html',
      key: 'sqlref-changes-21c',
    },
    {
      name: 'SQL Ref: SELECT',
      url: 'https://docs.oracle.com/en/database/oracle/oracle-database/21/sqlrf/SELECT.html',
      key: 'sqlref-select',
    },
    {
      name: 'SQL Ref: CREATE TABLE',
      url: 'https://docs.oracle.com/en/database/oracle/oracle-database/21/sqlrf/CREATE-TABLE.html',
      key: 'sqlref-create-table',
    },
    {
      name: 'Exadata Overview',
      url: 'https://docs.oracle.com/en/engineered-systems/exadata-cloud-service/ecscm/exadata-cloud-infrastructure-overview.html',
      key: 'exadata-overview',
    },
  ];

  const results = [];

  for (const page of testPages) {
    console.log(`\n${'─'.repeat(70)}`);
    console.log(`  ${page.name}`);
    console.log(`  ${page.url}`);
    console.log('─'.repeat(70));

    try {
      const html = await fetchCached(page.url, page.key);
      const extracted = extractWithDescriptor(html, descriptor, page.url);

      const sectionCount = extracted.sections?.length || 0;
      const childLinkCount = extracted.child_links?.length || 0;
      const totalSubsections = (extracted.sections || []).reduce((sum, s) =>
        sum + (s.subsections?.length || 0), 0);
      const totalCodeBlocks = (extracted.sections || []).reduce((sum, s) =>
        sum + (s.code?.length || 0) + (s.subsections || []).reduce((s2, sub) =>
          s2 + (sub.code?.length || 0), 0), 0);
      const totalTables = (extracted.sections || []).reduce((sum, s) =>
        sum + (s.tables?.length || 0), 0);

      console.log(`  Title: ${extracted.title}`);
      console.log(`  Sections: ${sectionCount}, Subsections: ${totalSubsections}, Code: ${totalCodeBlocks}, Tables: ${totalTables}, Links: ${childLinkCount}`);

      // Show first 3 section headings
      if (extracted.sections?.length) {
        console.log(`  Section headings (first 5):`);
        for (const sec of extracted.sections.slice(0, 5)) {
          const subCount = sec.subsections?.length || 0;
          const contentLen = sec.content?.length || 0;
          console.log(`    - "${sec.heading}" (${contentLen} chars${subCount ? `, ${subCount} subsections` : ''})`);
        }
      }

      // Token comparison
      const rawTokens = countTokens(html);

      // For TOON: encode sections as structured data
      const toonData = {
        title: extracted.title,
        sections: (extracted.sections || []).map(s => ({
          heading: s.heading || '',
          content: (s.content || '').substring(0, 500),
          code: s.code?.length || 0,
          tables: s.tables?.length || 0,
          subsections: (s.subsections || []).length,
        }))
      };
      const toonStr = toonEncode(toonData);
      const jsonStr = JSON.stringify(extracted, null, 2);
      const mdStr = sectionsToMarkdown(extracted);

      const jsonTokens = countTokens(jsonStr);
      const toonTokens = countTokens(toonStr);
      const mdTokens = countTokens(mdStr);

      console.log(`\n  Token comparison:`);
      console.log(`    Raw HTML:  ${rawTokens.toLocaleString()} tokens`);
      console.log(`    JSON:      ${jsonTokens.toLocaleString()} tokens (${((1 - jsonTokens / rawTokens) * 100).toFixed(0)}% less)`);
      console.log(`    TOON:      ${toonTokens.toLocaleString()} tokens (${((1 - toonTokens / rawTokens) * 100).toFixed(0)}% less)`);
      console.log(`    Markdown:  ${mdTokens.toLocaleString()} tokens (${((1 - mdTokens / rawTokens) * 100).toFixed(0)}% less)`);

      // Cache
      const c = { jsonBytes: jsonStr.length, gzipBytes: gzipSync(Buffer.from(jsonStr)).length };
      console.log(`    Cache:     ${c.jsonBytes.toLocaleString()}B → ${c.gzipBytes.toLocaleString()}B gzip (${((1 - c.gzipBytes / c.jsonBytes) * 100).toFixed(0)}% compression)`);

      const passed = !!extracted.title && sectionCount > 0;
      console.log(`\n  Result: ${passed ? 'PASS' : 'WARN'}`);

      results.push({ name: page.name, passed, rawTokens, jsonTokens, toonTokens, mdTokens, sectionCount, totalSubsections });

      await new Promise(r => setTimeout(r, 200));
    } catch (e) {
      console.log(`  FAIL: ${e.message}`);
      results.push({ name: page.name, passed: false, error: e.message });
    }
  }

  // Summary
  console.log('\n\n' + '='.repeat(70));
  console.log('  ORACLE STANDARD DOCS — SUMMARY');
  console.log('='.repeat(70));
  console.log('\n  Page                      | Extract  | Raw HTML  | Markdown  | Reduction');
  console.log('  ' + '-'.repeat(68));
  for (const r of results) {
    if (r.rawTokens) {
      console.log(`  ${r.name.padEnd(28)}| ${r.passed ? 'PASS' : 'FAIL'}     | ${String(r.rawTokens.toLocaleString()).padStart(8)} | ${String(r.mdTokens.toLocaleString()).padStart(8)}  | ${((1 - r.mdTokens / r.rawTokens) * 100).toFixed(0)}%`);
    }
  }

  const totalRaw = results.reduce((s, r) => s + (r.rawTokens || 0), 0);
  const totalMd = results.reduce((s, r) => s + (r.mdTokens || 0), 0);
  console.log('  ' + '-'.repeat(68));
  console.log(`  ${'TOTAL'.padEnd(28)}|          | ${totalRaw.toLocaleString().padStart(8)} | ${totalMd.toLocaleString().padStart(8)}  | ${((1 - totalMd / totalRaw) * 100).toFixed(0)}%`);

  console.log('\n  Pass: ' + results.filter(r => r.passed).length + '/' + results.length);
  console.log('='.repeat(70));
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
