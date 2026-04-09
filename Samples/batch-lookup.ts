/**
 * Batch lookup — fetch multiple errors and output in all three formats.
 *
 * Run: npx tsx Samples/batch-lookup.ts
 */
import Distill, { format } from 'distill';

async function main() {
  const client = new Distill();

  const codes = ['ORA-00001', 'ORA-12154', 'ORA-00060'];
  console.log(`Fetching ${codes.length} errors...\n`);

  const errors = await client.fetchErrors(codes);

  // TOON — compact, LLM-optimized
  console.log('=== TOON Format ===');
  console.log(format(errors, 'toon'));

  // Markdown — human-readable
  console.log('\n=== Markdown Format ===');
  console.log(format(errors, 'markdown'));

  // JSON — programmatic
  console.log('\n=== JSON Format ===');
  console.log(format(errors, 'json'));
}

main().catch(console.error);
