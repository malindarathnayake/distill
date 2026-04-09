import { describe, it, expect } from 'vitest';
import { normalizeOraCode } from '../normalize.js';
import { InvalidCodeError } from '../errors.js';

describe('normalizeOraCode', () => {
  const validCases: [string, string][] = [
    ['ORA-00001', 'ora-00001'],
    ['ora-00001', 'ora-00001'],
    ['ORA-1', 'ora-00001'],
    ['ora00001', 'ora-00001'],
    ['ORA-12154', 'ora-12154'],
    ['  ORA-00001  ', 'ora-00001'],
    ['ORA-54', 'ora-00054'],
  ];

  it.each(validCases)('normalizes %s to %s', (input, expected) => {
    expect(normalizeOraCode(input)).toBe(expected);
  });

  const errorCases: [string, string][] = [
    ['', 'empty'],
    ['   ', 'empty'],
    ['TNS-12154', 'Only ORA prefix'],
    ['ORA-abc', 'invalid'],
    ['ORA-100000', 'exceeds'],
    ['INVALID', 'invalid'],
  ];

  it.each(errorCases)('throws InvalidCodeError for %s', (input) => {
    expect(() => normalizeOraCode(input)).toThrow(InvalidCodeError);
  });
});
