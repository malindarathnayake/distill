import { describe, it, expect } from 'vitest';
import {
  formatToon,
  formatToonBatch,
  formatToonGeneric,
  formatMarkdown,
  formatMarkdownBatch,
  formatMarkdownGeneric,
  formatJson,
  formatJsonBatch,
  formatJsonGeneric,
  format,
} from '../formatters/index.js';
import type { OracleError } from '../types.js';

const sampleError: OracleError = {
  code: 'ORA-00001',
  message: 'unique constraint violated',
  parameters: [
    { name: 'constraint_name', description: 'The name of the constraint.' },
    { name: 'table_name', description: 'The name of the table.' },
  ],
  cause: 'An INSERT statement attempted to insert a duplicate key.',
  action: 'Remove the unique restriction or do not insert the key.',
  additionalInfo: 'Check constraint details.',
  sql: [
    "SELECT constraint_name FROM all_constraints WHERE owner = 'SCOTT';",
  ],
  release: '23ai',
  url: 'https://docs.oracle.com/en/error-help/db/ora-00001/',
};

const minimalError: OracleError = {
  code: 'ORA-00017',
  message: 'session requested to set trace event',
  parameters: [],
  cause: 'The current session was requested to set a trace event.',
  action: 'No action is required.',
  url: 'https://docs.oracle.com/en/error-help/db/ora-00017/',
};

const thirdError: OracleError = {
  code: 'ORA-00018',
  message: 'maximum number of sessions exceeded',
  parameters: [],
  cause: 'All session state objects are in use.',
  action: 'Increase the value of the SESSIONS initialization parameter.',
  url: 'https://docs.oracle.com/en/error-help/db/ora-00018/',
};

describe('TOON formatters', () => {
  it('formatToon returns string containing error code', () => {
    const result = formatToon(sampleError);
    expect(typeof result).toBe('string');
    expect(result).toContain('ORA-00001');
    expect(result).toContain('unique constraint violated');
    expect(result).toContain('An INSERT statement attempted');
    expect(result).toContain('Remove the unique restriction');
    expect(result).toContain('https://docs.oracle.com/en/error-help/db/ora-00001/');
  });

  it('formatToonBatch returns string containing all error codes', () => {
    const result = formatToonBatch([sampleError, minimalError, thirdError]);
    expect(typeof result).toBe('string');
    expect(result).toContain('ORA-00001');
    expect(result).toContain('ORA-00017');
    expect(result).toContain('ORA-00018');
  });

  it('formatToonGeneric returns string containing key', () => {
    const result = formatToonGeneric({ key: 'value' });
    expect(typeof result).toBe('string');
    expect(result).toContain('key');
  });
});

describe('Markdown formatters', () => {
  it('formatMarkdown contains required sections for full error', () => {
    const result = formatMarkdown(sampleError);
    expect(result).toContain('# ORA-00001');
    expect(result).toContain('**unique constraint violated**');
    expect(result).toContain('## Parameters');
    expect(result).toContain('## Cause');
    expect(result).toContain('## Action');
    expect(result).toContain('## Additional Information');
    expect(result).toContain('## SQL Examples');
    expect(result).toContain('```sql');
    expect(result).toContain('> Source:');
    expect(result).toContain('- **constraint_name:** The name of the constraint.');
    expect(result).toContain("SELECT constraint_name FROM all_constraints WHERE owner = 'SCOTT';");
    expect(result).toContain('Check constraint details.');
  });

  it('formatMarkdown minimal error does not contain optional sections', () => {
    const result = formatMarkdown(minimalError);
    expect(result).not.toContain('## Additional Information');
    expect(result).not.toContain('## SQL Examples');
  });

  it('formatMarkdownBatch contains separator between errors', () => {
    const result = formatMarkdownBatch([sampleError, minimalError, thirdError]);
    expect(result).toContain('---');
  });

  it('formatMarkdownGeneric renders key-value pairs', () => {
    const result = formatMarkdownGeneric({ name: 'test', count: 42 });
    expect(result).toContain('**name:** test');
  });
});

describe('JSON formatters', () => {
  it('formatJson returns valid JSON matching sampleError', () => {
    const result = formatJson(sampleError);
    expect(() => JSON.parse(result)).not.toThrow();
    expect(JSON.parse(result)).toEqual(sampleError);
  });

  it('formatJson with pretty=true contains newlines', () => {
    const result = formatJson(sampleError, true);
    expect(result).toContain('\n');
  });

  it('formatJson without pretty is compact (no newlines)', () => {
    const result = formatJson(sampleError);
    expect(result).not.toContain('\n');
  });

  it('formatJsonBatch returns valid JSON array', () => {
    const result = formatJsonBatch([sampleError]);
    expect(() => JSON.parse(result)).not.toThrow();
    expect(Array.isArray(JSON.parse(result))).toBe(true);
  });

  it('formatJsonGeneric returns valid JSON', () => {
    const result = formatJsonGeneric({ a: 1 });
    expect(() => JSON.parse(result)).not.toThrow();
    expect(JSON.parse(result)).toEqual({ a: 1 });
  });
});

describe('format dispatcher', () => {
  it('routes single OracleError to toon formatter', () => {
    const result = format(sampleError, 'toon');
    expect(typeof result).toBe('string');
    expect(result).toContain('ORA-00001');
  });

  it('routes single OracleError to markdown formatter', () => {
    const result = format(sampleError, 'markdown');
    expect(result).toContain('# ORA-00001');
  });

  it('routes single OracleError to json formatter', () => {
    const result = format(sampleError, 'json');
    expect(JSON.parse(result)).toEqual(sampleError);
  });

  it('routes array to batch toon formatter', () => {
    const result = format([sampleError, minimalError, thirdError], 'toon');
    expect(result).toContain('ORA-00001');
    expect(result).toContain('ORA-00017');
    expect(result).toContain('ORA-00018');
  });

  it('routes array to batch markdown formatter', () => {
    const result = format([sampleError, minimalError, thirdError], 'markdown');
    expect(result).toContain('---');
  });

  it('routes array to batch json formatter', () => {
    const result = format([sampleError, minimalError, thirdError], 'json');
    expect(Array.isArray(JSON.parse(result))).toBe(true);
  });

  it('routes generic object to generic toon formatter', () => {
    const result = format({ greeting: 'hello' }, 'toon');
    expect(result).toContain('greeting');
  });

  it('routes generic object to generic markdown formatter', () => {
    const result = format({ greeting: 'hello' }, 'markdown');
    expect(result).toContain('**greeting:** hello');
  });

  it('routes generic object to generic json formatter', () => {
    const result = format({ greeting: 'hello' }, 'json');
    expect(JSON.parse(result)).toEqual({ greeting: 'hello' });
  });

  it('detects OracleError correctly (has code, message, cause)', () => {
    const result = format(sampleError, 'markdown');
    // OracleError path produces header with #
    expect(result).toContain('# ORA-00001');
  });

  it('detects generic object correctly (missing cause property)', () => {
    const result = format({ code: 'test', message: 'hello' }, 'markdown');
    // Generic path produces key-value lines, not markdown headers
    expect(result).toContain('**code:** test');
    expect(result).not.toContain('# test');
  });
});
