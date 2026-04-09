import { encode } from '@toon-format/toon';
import type { OracleError } from '../types.js';

export function formatToon(data: OracleError): string {
  return encode(data);
}

export function formatToonBatch(data: OracleError[]): string {
  return encode(data);
}

export function formatToonGeneric(data: Record<string, unknown>): string {
  return encode(data);
}
