/**
 * Cache warming — pre-fetch errors for offline use with progress tracking.
 *
 * Run: npx tsx Samples/cache-warming.ts
 */
import Distill from 'distill';

async function main() {
  const client = new Distill();

  // Warm specific codes your team commonly encounters
  const commonErrors = [
    'ORA-00001', // unique constraint violated
    'ORA-00060', // deadlock
    'ORA-00942', // table or view does not exist
    'ORA-01017', // invalid credential
    'ORA-04031', // out of shared memory
    'ORA-12154', // cannot resolve connect identifier
  ];

  console.log(`Warming cache for ${commonErrors.length} common errors...`);

  await client.warm({
    codes: commonErrors,
    concurrency: 3,
    onProgress: (done, total) => {
      const pct = Math.round((done / total) * 100);
      process.stderr.write(`\r  [${done}/${total}] ${pct}%`);
    },
  });

  console.log('\n  Done. Subsequent lookups will be instant.\n');

  // Verify: this should come from cache now
  const start = Date.now();
  const error = await client.fetchError('ORA-00001');
  const elapsed = Date.now() - start;

  console.log(`Cached lookup for ${error.code}: ${elapsed}ms`);
}

main().catch(console.error);
