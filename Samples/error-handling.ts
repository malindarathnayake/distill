/**
 * Error handling — gracefully handle all error types.
 *
 * Run: npx tsx Samples/error-handling.ts
 */
import Distill, {
  InvalidCodeError,
  ErrorNotFoundError,
  FetchTimeoutError,
  NetworkError,
  ExtractionError,
} from 'distill';

async function lookup(client: InstanceType<typeof Distill>, code: string) {
  try {
    const error = await client.fetchError(code);
    console.log(`  ${error.code}: ${error.message.slice(0, 60)}...`);
  } catch (err) {
    if (err instanceof InvalidCodeError) {
      console.log(`  [INVALID] "${code}" is not a valid error code format`);
    } else if (err instanceof ErrorNotFoundError) {
      console.log(`  [NOT FOUND] ${err.errorCode} does not exist at ${err.url}`);
    } else if (err instanceof FetchTimeoutError) {
      console.log(`  [TIMEOUT] Request timed out after ${err.timeoutMs}ms`);
    } else if (err instanceof NetworkError) {
      console.log(`  [NETWORK] Failed to reach ${err.url}`);
    } else if (err instanceof ExtractionError) {
      console.log(`  [EXTRACTION] Could not extract data: ${err.message}`);
    } else {
      console.log(`  [UNKNOWN] ${err}`);
    }
  }
}

async function main() {
  const client = new Distill({ cache: false, timeout: 5000 });

  console.log('Testing various inputs:\n');

  // Valid code
  await lookup(client, 'ORA-00001');

  // Short form — normalized automatically
  await lookup(client, 'ORA-1');

  // Non-existent code — 404
  await lookup(client, 'ORA-99999');

  // Invalid format
  await lookup(client, 'INVALID');

  // Non-ORA prefix
  await lookup(client, 'PLS-00001');
}

main().catch(console.error);
