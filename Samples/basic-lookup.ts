/**
 * Basic error lookup — fetch a single ORA error and print its fields.
 *
 * Run: npx tsx Samples/basic-lookup.ts
 */
import Distill from 'distill';

async function main() {
  const client = new Distill();

  const error = await client.fetchError('ORA-00001');

  console.log('Code:', error.code);
  console.log('Message:', error.message);
  console.log('Cause:', error.cause);
  console.log('Action:', error.action);

  if (error.parameters.length > 0) {
    console.log('\nParameters:');
    for (const p of error.parameters) {
      console.log(`  ${p.name}: ${p.description}`);
    }
  }

  if (error.sql && error.sql.length > 0) {
    console.log('\nSQL Examples:');
    for (const sql of error.sql) {
      console.log(`  ${sql}`);
    }
  }

  console.log('\nSource:', error.url);
}

main().catch(console.error);
