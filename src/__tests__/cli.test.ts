import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixtureHtml = fs.readFileSync(
  path.join(__dirname, '../../test/fixtures/ora-00001.html'),
  'utf-8',
);

function makeResponse(status: number, body = ''): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    text: () => Promise.resolve(body),
  } as unknown as Response;
}

let mockFetch: ReturnType<typeof vi.fn>;

describe('CLI run()', () => {
  let stdoutOutput: string;
  let stderrOutput: string;

  beforeEach(() => {
    stdoutOutput = '';
    stderrOutput = '';
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: any) => {
      stdoutOutput += chunk.toString();
      return true;
    });
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk: any) => {
      stderrOutput += chunk.toString();
      return true;
    });
    mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  it('--help prints usage to stdout', async () => {
    const { run } = await import('../cli.js');
    await run(['--help']);
    expect(stdoutOutput).toContain('Usage:');
    expect(stdoutOutput).toContain('distill');
    expect(process.exitCode).toBeUndefined();
  });

  it('-h prints usage to stdout', async () => {
    const { run } = await import('../cli.js');
    await run(['-h']);
    expect(stdoutOutput).toContain('Usage:');
    expect(stdoutOutput).toContain('distill');
    expect(process.exitCode).toBeUndefined();
  });

  it('single code outputs TOON format by default', async () => {
    mockFetch.mockResolvedValueOnce(makeResponse(200, fixtureHtml));
    const { run } = await import('../cli.js');
    await run(['ORA-00001']);
    expect(stdoutOutput).toContain('ORA-00001');
    expect(process.exitCode).toBeUndefined();
  });

  it('--format json outputs valid JSON', async () => {
    mockFetch.mockResolvedValueOnce(makeResponse(200, fixtureHtml));
    const { run } = await import('../cli.js');
    await run(['ORA-00001', '--format', 'json']);
    const parsed = JSON.parse(stdoutOutput.trim());
    expect(parsed).toBeTruthy();
    expect(typeof parsed).toBe('object');
    expect(process.exitCode).toBeUndefined();
  });

  it('--format=json (equals syntax) outputs valid JSON', async () => {
    mockFetch.mockResolvedValueOnce(makeResponse(200, fixtureHtml));
    const { run } = await import('../cli.js');
    await run(['ORA-00001', '--format=json']);
    const parsed = JSON.parse(stdoutOutput.trim());
    expect(parsed).toBeTruthy();
    expect(process.exitCode).toBeUndefined();
  });

  it('--format markdown outputs markdown', async () => {
    mockFetch.mockResolvedValueOnce(makeResponse(200, fixtureHtml));
    const { run } = await import('../cli.js');
    await run(['ORA-00001', '--format', 'markdown']);
    expect(stdoutOutput).toContain('# ORA-');
    expect(process.exitCode).toBeUndefined();
  });

  it('--list outputs code tab url lines containing ORA codes', async () => {
    const indexHtml = `
      <html><body>
        <a href="ora-00001/">ORA-00001</a>
        <a href="ora-00002/">ORA-00002</a>
        <a href="ora-00003/">ORA-00003</a>
      </body></html>
    `;
    mockFetch.mockResolvedValueOnce(makeResponse(200, indexHtml));
    const { run } = await import('../cli.js');
    await run(['--list']);
    expect(stdoutOutput).toContain('ORA-00001');
    expect(process.exitCode).toBeUndefined();
  });

  it('no args prints error to stderr and sets exitCode 1', async () => {
    const { run } = await import('../cli.js');
    await run([]);
    expect(stderrOutput).toMatch(/no error codes/i);
    expect(process.exitCode).toBe(1);
  });

  it('fetch error prints message to stderr and sets exitCode 1', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network failure'));
    const { run } = await import('../cli.js');
    await run(['ORA-99999']);
    // The fetcher wraps errors into NetworkError with its own message
    expect(stderrOutput).toMatch(/^Error:/);
    expect(process.exitCode).toBe(1);
  });

  it('invalid code format prints error and sets exitCode 1', async () => {
    const { run } = await import('../cli.js');
    await run(['INVALID']);
    expect(stderrOutput).toMatch(/Error:/);
    expect(process.exitCode).toBe(1);
  });

  it('multiple codes outputs batch format', async () => {
    mockFetch.mockResolvedValue(makeResponse(200, fixtureHtml));
    const { run } = await import('../cli.js');
    await run(['ORA-00001', 'ORA-00002']);
    expect(stdoutOutput).toBeTruthy();
    expect(stdoutOutput.length).toBeGreaterThan(10);
    expect(process.exitCode).toBeUndefined();
  });
});
