import { describe, it, expect } from 'vitest';
import { loadDescriptors, matchDescriptor } from '../descriptor-loader.js';

describe('loadDescriptors', () => {
  it('loads bundled descriptors', () => {
    const descriptors = loadDescriptors();
    expect(descriptors.length).toBeGreaterThanOrEqual(2);
    const names = descriptors.map(d => d.name);
    expect(names).toContain('oracle-error-docs');
    expect(names).toContain('oracle-standard-docs');
  });

  it('places user descriptors before bundled', () => {
    const userDesc = {
      name: 'custom',
      version: '1.0.0',
      description: 'test',
      url_pattern: 'https://example.com/{page}',
      root: 'main',
      fields: {},
    };
    const descriptors = loadDescriptors([userDesc as any]);
    expect(descriptors[0].name).toBe('custom');
  });
});

describe('matchDescriptor', () => {
  it('matches Oracle error docs URL', () => {
    const descriptors = loadDescriptors();
    const match = matchDescriptor(
      'https://docs.oracle.com/en/error-help/db/ora-00001/',
      descriptors
    );
    expect(match).not.toBeNull();
    expect(match!.name).toBe('oracle-error-docs');
  });

  it('matches Oracle standard docs URL', () => {
    const descriptors = loadDescriptors();
    const match = matchDescriptor(
      'https://docs.oracle.com/en/database/oracle/oracle-database/23/sqlrf/CREATE-TABLE.html',
      descriptors
    );
    expect(match).not.toBeNull();
    expect(match!.name).toBe('oracle-standard-docs');
  });

  it('returns null for unmatched URL', () => {
    const descriptors = loadDescriptors();
    const match = matchDescriptor('https://google.com/', descriptors);
    expect(match).toBeNull();
  });

  it('user descriptor overrides bundled on same URL pattern', () => {
    const override = {
      name: 'my-oracle-errors',
      version: '2.0.0',
      description: 'override',
      url_pattern: 'https://docs.oracle.com/en/error-help/db/{prefix}-{code}/',
      root: 'main',
      fields: {},
    };
    const descriptors = loadDescriptors([override as any]);
    const match = matchDescriptor(
      'https://docs.oracle.com/en/error-help/db/ora-00001/',
      descriptors
    );
    expect(match!.name).toBe('my-oracle-errors');
  });
});
