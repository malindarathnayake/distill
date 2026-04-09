import * as cheerio from 'cheerio';
import type { AnyNode } from 'domhandler';
import { ExtractionError } from './errors.js';
import type { Descriptor, DescriptorField, ProseRules, DescriptorMetadataField } from './types.js';

export function extract(html: string, descriptor: Descriptor, inputUrl: string): Record<string, unknown> {
  const $ = cheerio.load(html);

  // Cleanup
  if (descriptor.cleanup?.remove_selectors) {
    for (const sel of descriptor.cleanup.remove_selectors) $(sel).remove();
  }

  // Find root
  const root = $(descriptor.root).first();
  if (!root.length) throw new ExtractionError(`Root selector "${descriptor.root}" not found`, inputUrl);

  // Find section
  let section = root;
  if (descriptor.section) {
    const found = root.find(descriptor.section.selector).first();
    if (found.length) {
      section = found;
    } else if (descriptor.section.fallback) {
      const fallback = root.find(descriptor.section.fallback).first();
      section = fallback.length ? fallback : root;
    } else {
      section = root;
    }
  }

  // Extract fields
  const result: Record<string, unknown> = {};
  for (const [fieldName, rule] of Object.entries(descriptor.fields)) {
    const value = extractField($, section, rule, descriptor.prose_rules);
    if (value !== null && value !== undefined && value !== '' && !(Array.isArray(value) && value.length === 0)) {
      result[fieldName] = value;
    } else if (rule.required) {
      throw new ExtractionError(`Required field "${fieldName}" is empty or missing`, inputUrl);
    }
  }

  // Metadata
  if (descriptor.metadata) {
    for (const [k, v] of Object.entries(descriptor.metadata)) {
      if (v.source === 'section_attr') {
        result[k] = section.attr(v.attr as string) || undefined;
      } else if (v.source === 'input_url') {
        result[k] = inputUrl;
      } else if (v.source === 'first_match_attr') {
        const el = root.find((v as DescriptorMetadataField & { selector: string }).selector).first();
        result[k] = el.length ? el.attr(v.attr as string) : undefined;
      }
    }
  }

  return result;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractProse($: cheerio.CheerioAPI, container: cheerio.Cheerio<AnyNode>, rules: ProseRules | undefined): string {
  const parts: string[] = [];
  const pr = rules || {
    paragraph_selector: 'p',
    list_selector: 'ul > li, ol > li',
    list_prefix: '- ',
    join: '\n',
    trim: true,
  };
  container.find(pr.paragraph_selector).each((_i, el) => {
    const t = $(el).text().trim();
    if (t) parts.push(t);
  });
  container.find(pr.list_selector).each((_i, el) => {
    const t = $(el).text().trim();
    if (t) parts.push((pr.list_prefix || '- ') + t);
  });
  const joined = parts.join(pr.join || '\n');
  return pr.trim ? joined.trim() : joined;
}

function extractCodeBlocks($: cheerio.CheerioAPI, container: cheerio.Cheerio<AnyNode>, selector: string): string[] | null {
  const blocks: string[] = [];
  container.find(selector).each((_i, el) => {
    const t = $(el).text().trim();
    if (t) blocks.push(t);
  });
  return blocks.length > 0 ? blocks : null;
}

function extractNestedSections(
  $: cheerio.CheerioAPI,
  container: cheerio.Cheerio<AnyNode>,
  rule: DescriptorField,
  proseRules: ProseRules | undefined,
  depth: number
): unknown[] | null {
  if (depth > (rule.max_depth || 3)) return null;
  const sections: unknown[] = [];
  const headingSelectors = (rule.heading_selectors as string[]).join(', ');
  const sectionSelectors = (rule.section_selectors as string[]).join(', ');
  const childSections = container.children(sectionSelectors);

  if (childSections.length > 0) {
    childSections.each((_i, sectionEl) => {
      const sec = $(sectionEl);
      const sectionObj = extractSectionContent($, sec, rule, proseRules, depth);
      if (sectionObj && (
        (sectionObj as Record<string, unknown>).heading ||
        (sectionObj as Record<string, unknown>).content ||
        ((sectionObj as Record<string, unknown>).subsections as unknown[] | undefined)?.length
      )) {
        sections.push(sectionObj);
      }
    });
  } else {
    const headings = container.find(headingSelectors);
    headings.each((_i, hEl) => {
      const heading = $(hEl).text().trim();
      if (!heading) return;
      const content: string[] = [];
      let next = $(hEl).next();
      while (next.length && !next.is(headingSelectors)) {
        if (next.is('p')) {
          const t = next.text().trim();
          if (t) content.push(t);
        } else if (next.is('ul, ol')) {
          next.find('> li').each((_j, li) => {
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

function extractSectionContent(
  $: cheerio.CheerioAPI,
  sec: cheerio.Cheerio<AnyNode>,
  rule: DescriptorField,
  proseRules: ProseRules | undefined,
  depth: number
): Record<string, unknown> | null {
  const headingSelectors = (rule.heading_selectors as string[]).join(', ');
  const headingEl = sec.find(headingSelectors).first();
  const heading = headingEl.length ? headingEl.text().trim() : '';
  const proseSelector = proseRules?.paragraph_selector || 'p';
  const contentParts: string[] = [];
  sec.find(`> ${proseSelector}, > div > ${proseSelector}`).each((_i, el) => {
    if ($(el).is(headingSelectors)) return;
    const t = $(el).text().trim();
    if (t && t.length > 5) contentParts.push(t);
  });
  sec.find('> ul > li, > div > ul > li, > ol > li, > div > ol > li').each((_i, el) => {
    const t = $(el).text().trim();
    if (t) contentParts.push('- ' + t);
  });
  const codeBlocks: string[] = [];
  const codeSel = rule.code_selector || 'pre code';
  sec.find(codeSel).each((_i, el) => {
    const code = $(el).text().trim();
    if (code) {
      codeBlocks.push(code);
      contentParts.push('```\n' + code + '\n```');
    }
  });
  const subsections = extractNestedSections($, sec, rule, proseRules, depth + 1);
  const content = contentParts.join('\n');
  if (!heading && !content && !subsections?.length) return null;
  const result: Record<string, unknown> = { heading };
  if (content) result.content = content;
  if (codeBlocks.length) result.code = codeBlocks;
  if (subsections?.length) result.subsections = subsections;
  return result;
}

function extractField(
  $: cheerio.CheerioAPI,
  section: cheerio.Cheerio<AnyNode>,
  rule: DescriptorField,
  proseRules: ProseRules | undefined
): unknown {
  switch (rule.extract) {
    case 'text': {
      const el = section.find(rule.selector as string).first();
      let text = el.text().trim();
      if (rule.regex) {
        const m = text.match(new RegExp(rule.regex));
        text = m ? m[1] : text;
      }
      return text || null;
    }

    case 'attr': {
      const el = section.find(rule.selector as string).first();
      return el.attr(rule.attr as string) || null;
    }

    case 'list': {
      const items: Record<string, string>[] = [];
      section.find(rule.selector as string).each((_i, el) => {
        const item: Record<string, string> = {};
        for (const [subName, subRule] of Object.entries(rule.item_fields as Record<string, DescriptorField>)) {
          if (subRule.extract === 'text') {
            item[subName] = $(el).find(subRule.selector as string).first().text().trim();
          } else if (subRule.extract === 'text_after') {
            const afterEl = $(el).find(subRule.after as string).first();
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
      const headings = section.find(rule.heading_tag as string);
      let targetHeading: cheerio.Cheerio<AnyNode> | null = null;
      headings.each((_i, el) => {
        if ($(el).text().trim().toLowerCase().includes((rule.heading as string).toLowerCase())) {
          if (!targetHeading) targetHeading = $(el);
        }
      });
      if (!targetHeading) return null;

      // CRITICAL: Use nextAll().first() instead of next() for robustness
      // If there's an <hr> between heading and content div, next(selector) won't find it
      const contentDiv = (targetHeading as cheerio.Cheerio<AnyNode>).nextAll(rule.content_selector as string).first();
      if (!contentDiv.length) return null;

      if (rule.content_extract === 'prose') return extractProse($, contentDiv, proseRules);
      if (rule.content_extract === 'code_blocks') return extractCodeBlocks($, contentDiv, rule.code_selector || 'pre code');
      return contentDiv.text().trim() || null;
    }

    case 'nested_sections': {
      return extractNestedSections($, section, rule, proseRules, 0);
    }

    case 'link_list': {
      const links: { text: string; href: string }[] = [];
      section.find(rule.selector as string).each((_i, el) => {
        const text = $(el).text().trim();
        const href = $(el).attr('href');
        if (text && href) links.push({ text, href });
      });
      return links.length > 0 ? links : null;
    }

    case 'repeating_group': {
      const anchors = section.find(rule.group_anchor as string);
      const items: Record<string, string>[] = [];
      anchors.each((_i, anchorEl) => {
        const item: Record<string, string> = {};
        const anchor = $(anchorEl);
        for (const [subName, subRule] of Object.entries(rule.item_fields as Record<string, DescriptorField>)) {
          let target = anchor;
          if (subRule.offset !== undefined && subRule.offset !== 0) {
            for (let step = 0; step < (subRule.offset as number); step++) {
              target = target.next();
            }
          }
          if (!target.length) continue;
          let text: string;
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
