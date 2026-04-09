import type { OracleError } from '../types.js';

export function formatJson(data: OracleError, pretty?: boolean): string {
  return JSON.stringify(data, null, pretty ? 2 : undefined);
}

export function formatJsonBatch(data: OracleError[], pretty?: boolean): string {
  return JSON.stringify(data, null, pretty ? 2 : undefined);
}

export function formatJsonGeneric(data: Record<string, unknown>, pretty?: boolean): string {
  return JSON.stringify(data, null, pretty ? 2 : undefined);
}
