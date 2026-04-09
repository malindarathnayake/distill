import { readFileSync } from 'fs';
import { describe, it, expect } from 'vitest';
import { extract } from '../extractor.js';
import { ExtractionError } from '../errors.js';
import type { Descriptor } from '../types.js';

// Load descriptor
const oracleDescriptor: Descriptor = JSON.parse(
  readFileSync('descriptors/oracle-error-docs.json', 'utf-8')
);

// Load fixtures
const ora00001Html = readFileSync('test/fixtures/ora-00001.html', 'utf-8');
const ora12154Html = readFileSync('test/fixtures/ora-12154.html', 'utf-8');

describe('extract — ORA-00001 fixture', () => {
  let result: Record<string, unknown>;

  it('extracts without throwing', () => {
    result = extract(ora00001Html, oracleDescriptor, 'https://docs.oracle.com/en/error-help/db/ora-00001/');
    expect(result).toBeTruthy();
  });

  it('extracts the error code', () => {
    const r = extract(ora00001Html, oracleDescriptor, 'https://docs.oracle.com/en/error-help/db/ora-00001/');
    expect(r.code).toBe('ORA-00001');
  });

  it('extracts the message string', () => {
    const r = extract(ora00001Html, oracleDescriptor, 'https://docs.oracle.com/en/error-help/db/ora-00001/');
    expect(typeof r.message).toBe('string');
    expect((r.message as string).length).toBeGreaterThan(0);
    expect(r.message).toContain('unique constraint');
  });

  it('extracts parameters as an array with 5 items', () => {
    const r = extract(ora00001Html, oracleDescriptor, 'https://docs.oracle.com/en/error-help/db/ora-00001/');
    expect(Array.isArray(r.parameters)).toBe(true);
    expect((r.parameters as unknown[]).length).toBe(5);
  });

  it('each parameter has name and description fields', () => {
    const r = extract(ora00001Html, oracleDescriptor, 'https://docs.oracle.com/en/error-help/db/ora-00001/');
    const params = r.parameters as Array<{ name: string; description: string }>;
    for (const p of params) {
      expect(typeof p.name).toBe('string');
      expect(p.name.length).toBeGreaterThan(0);
      expect(typeof p.description).toBe('string');
      expect(p.description.length).toBeGreaterThan(0);
    }
  });

  it('first parameter is constraint_schema', () => {
    const r = extract(ora00001Html, oracleDescriptor, 'https://docs.oracle.com/en/error-help/db/ora-00001/');
    const params = r.parameters as Array<{ name: string; description: string }>;
    expect(params[0].name).toBe('constraint_schema');
    expect(params[0].description).toContain('schema');
  });

  it('extracts cause as a non-empty string', () => {
    const r = extract(ora00001Html, oracleDescriptor, 'https://docs.oracle.com/en/error-help/db/ora-00001/');
    expect(typeof r.cause).toBe('string');
    expect((r.cause as string).length).toBeGreaterThan(0);
    expect(r.cause).toContain('unique constraint');
  });

  it('extracts action as a non-empty string', () => {
    const r = extract(ora00001Html, oracleDescriptor, 'https://docs.oracle.com/en/error-help/db/ora-00001/');
    expect(typeof r.action).toBe('string');
    expect((r.action as string).length).toBeGreaterThan(0);
    expect(r.action).toContain('unique constraint');
  });

  it('extracts additionalInfo as a non-empty string', () => {
    const r = extract(ora00001Html, oracleDescriptor, 'https://docs.oracle.com/en/error-help/db/ora-00001/');
    expect(typeof r.additionalInfo).toBe('string');
    expect((r.additionalInfo as string).length).toBeGreaterThan(0);
  });

  it('extracts sql as an array of 5 code blocks', () => {
    const r = extract(ora00001Html, oracleDescriptor, 'https://docs.oracle.com/en/error-help/db/ora-00001/');
    expect(Array.isArray(r.sql)).toBe(true);
    expect((r.sql as unknown[]).length).toBe(5);
  });

  it('each sql block is a non-empty string', () => {
    const r = extract(ora00001Html, oracleDescriptor, 'https://docs.oracle.com/en/error-help/db/ora-00001/');
    const sql = r.sql as string[];
    for (const block of sql) {
      expect(typeof block).toBe('string');
      expect(block.length).toBeGreaterThan(0);
    }
  });

  it('extracts release metadata from section id attribute', () => {
    const r = extract(ora00001Html, oracleDescriptor, 'https://docs.oracle.com/en/error-help/db/ora-00001/');
    expect(r.release).toBe('26ai');
  });

  it('sets url metadata to the input url', () => {
    const inputUrl = 'https://docs.oracle.com/en/error-help/db/ora-00001/';
    const r = extract(ora00001Html, oracleDescriptor, inputUrl);
    expect(r.url).toBe(inputUrl);
  });
});

describe('extract — ORA-12154 fixture', () => {
  it('extracts the error code', () => {
    const r = extract(ora12154Html, oracleDescriptor, 'https://docs.oracle.com/en/error-help/db/ora-12154/');
    expect(r.code).toBe('ORA-12154');
  });

  it('extracts the message string', () => {
    const r = extract(ora12154Html, oracleDescriptor, 'https://docs.oracle.com/en/error-help/db/ora-12154/');
    expect(typeof r.message).toBe('string');
    expect((r.message as string).length).toBeGreaterThan(0);
  });

  it('extracts parameters as an array with 2 items', () => {
    const r = extract(ora12154Html, oracleDescriptor, 'https://docs.oracle.com/en/error-help/db/ora-12154/');
    expect(Array.isArray(r.parameters)).toBe(true);
    expect((r.parameters as unknown[]).length).toBe(2);
  });

  it('extracts cause as a non-empty string', () => {
    const r = extract(ora12154Html, oracleDescriptor, 'https://docs.oracle.com/en/error-help/db/ora-12154/');
    expect(typeof r.cause).toBe('string');
    expect((r.cause as string).length).toBeGreaterThan(0);
    expect(r.cause).toContain('connection');
  });

  it('extracts action as a non-empty string', () => {
    const r = extract(ora12154Html, oracleDescriptor, 'https://docs.oracle.com/en/error-help/db/ora-12154/');
    expect(typeof r.action).toBe('string');
    expect((r.action as string).length).toBeGreaterThan(0);
  });

  it('has no additionalInfo field (not present in fixture)', () => {
    const r = extract(ora12154Html, oracleDescriptor, 'https://docs.oracle.com/en/error-help/db/ora-12154/');
    expect(r.additionalInfo).toBeUndefined();
  });

  it('has no sql field (not present in fixture)', () => {
    const r = extract(ora12154Html, oracleDescriptor, 'https://docs.oracle.com/en/error-help/db/ora-12154/');
    expect(r.sql).toBeUndefined();
  });

  it('extracts release metadata', () => {
    const r = extract(ora12154Html, oracleDescriptor, 'https://docs.oracle.com/en/error-help/db/ora-12154/');
    expect(r.release).toBe('26ai');
  });

  it('sets url metadata to the input url', () => {
    const inputUrl = 'https://docs.oracle.com/en/error-help/db/ora-12154/';
    const r = extract(ora12154Html, oracleDescriptor, inputUrl);
    expect(r.url).toBe(inputUrl);
  });
});

describe('extract — required field missing', () => {
  it('throws ExtractionError when a required field is missing', () => {
    // Minimal HTML that has the root but is missing Cause heading
    const minimalHtml = `
      <html><body>
        <main class="err">
          <div id="test" style="display: block;">
            <h2>ORA-00001</h2>
            <div class="st">some message</div>
          </div>
        </main>
      </body></html>
    `;

    expect(() => {
      extract(minimalHtml, oracleDescriptor, 'https://example.com/ora-00001/');
    }).toThrow(ExtractionError);
  });

  it('ExtractionError has the correct code', () => {
    const minimalHtml = `
      <html><body>
        <main class="err">
          <div id="test" style="display: block;">
            <h2>ORA-00001</h2>
            <div class="st">some message</div>
          </div>
        </main>
      </body></html>
    `;

    let caught: unknown;
    try {
      extract(minimalHtml, oracleDescriptor, 'https://example.com/ora-00001/');
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ExtractionError);
    expect((caught as ExtractionError).code).toBe('EXTRACTION_ERROR');
    expect((caught as ExtractionError).url).toBe('https://example.com/ora-00001/');
  });

  it('throws ExtractionError when root selector not found', () => {
    const emptyHtml = '<html><body><div>nothing here</div></body></html>';
    expect(() => {
      extract(emptyHtml, oracleDescriptor, 'https://example.com/');
    }).toThrow(ExtractionError);
  });
});

describe('extract — cleanup', () => {
  it('removes script and style content before extraction', () => {
    // Build HTML with a script tag inside the message div that would contaminate text
    const htmlWithScripts = `
      <html><body>
        <main class="err">
          <div id="sect" style="display: block;">
            <script>var x = "script content should be removed";</script>
            <style>.foo { color: red; }</style>
            <h2>ORA-00001</h2>
            <div class="st">clean message text</div>
            <h3>Cause</h3>
            <div class="ca"><p>cause text here for testing</p></div>
            <h3>Action</h3>
            <div class="ca"><p>action text here for testing</p></div>
          </div>
        </main>
      </body></html>
    `;

    const r = extract(htmlWithScripts, oracleDescriptor, 'https://example.com/ora-00001/');

    // Message should not contain script content
    expect(r.message).toBe('clean message text');
    expect(r.message).not.toContain('script content');
    expect(r.message).not.toContain('color: red');
  });

  it('removes nav tags before extraction', () => {
    const htmlWithNav = `
      <html><body>
        <nav>Navigation content that should be removed</nav>
        <main class="err">
          <div id="sect" style="display: block;">
            <h2>ORA-00001</h2>
            <div class="st">message text</div>
            <h3>Cause</h3>
            <div class="ca"><p>cause paragraph</p></div>
            <h3>Action</h3>
            <div class="ca"><p>action paragraph</p></div>
          </div>
        </main>
      </body></html>
    `;

    const r = extract(htmlWithNav, oracleDescriptor, 'https://example.com/ora-00001/');
    expect(r.code).toBe('ORA-00001');
    expect(r.message).toBe('message text');
    // Cause should not contain nav text
    expect(r.cause).not.toContain('Navigation content');
  });
});

describe('extract — custom minimal descriptor', () => {
  it('handles a simple text extraction descriptor', () => {
    const simpleDescriptor: Descriptor = {
      name: 'test',
      version: '1.0.0',
      description: 'test descriptor',
      url_pattern: 'https://example.com/{id}',
      root: 'div.content',
      fields: {
        title: {
          selector: 'h1',
          extract: 'text',
          required: true,
        },
        body: {
          selector: 'p.body',
          extract: 'text',
          required: false,
        },
      },
      metadata: {
        url: { source: 'input_url' },
      },
    };

    const html = `
      <html><body>
        <div class="content">
          <h1>Test Title</h1>
          <p class="body">Test body text</p>
        </div>
      </body></html>
    `;

    const r = extract(html, simpleDescriptor, 'https://example.com/test');
    expect(r.title).toBe('Test Title');
    expect(r.body).toBe('Test body text');
    expect(r.url).toBe('https://example.com/test');
  });

  it('throws ExtractionError for missing required field via custom descriptor', () => {
    const descriptorWithRequired: Descriptor = {
      name: 'test',
      version: '1.0.0',
      description: 'test descriptor',
      url_pattern: 'https://example.com/{id}',
      root: 'div.content',
      fields: {
        title: {
          selector: 'h1',
          extract: 'text',
          required: true,
        },
      },
    };

    const html = `
      <html><body>
        <div class="content">
          <p>No h1 here</p>
        </div>
      </body></html>
    `;

    expect(() => {
      extract(html, descriptorWithRequired, 'https://example.com/test');
    }).toThrow(ExtractionError);
  });
});
