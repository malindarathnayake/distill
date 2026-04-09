/**
 * LLM context injection — extract error docs and build a fenced prompt.
 *
 * Demonstrates how to safely inject extracted web content into an LLM prompt
 * by wrapping it in explicit data boundaries.
 *
 * Run: npx tsx Samples/llm-context-injection.ts
 */
import Distill, { format } from 'distill';

async function main() {
  const client = new Distill();

  // Simulate: user hit ORA-00001 and wants an LLM to help debug
  const errorCode = 'ORA-00001';
  const userQuery = 'I got this error inserting into the USERS table. The constraint is on the EMAIL column.';

  console.log(`Looking up ${errorCode}...`);
  const error = await client.fetchError(errorCode);

  // Use TOON for maximum context density
  const context = format(error, 'toon');

  // Build a safe prompt with fenced external data
  const prompt = `You are a database assistant helping debug Oracle errors.

<oracle-error-documentation source="docs.oracle.com" trust="external-web-content">
${context}
</oracle-error-documentation>

The user's question:
${userQuery}

Based on the official Oracle documentation above, explain what happened and suggest specific steps to fix it.`;

  console.log('\n=== Generated Prompt ===\n');
  console.log(prompt);
  console.log('\n=== Prompt Stats ===');
  console.log(`  Context length: ${context.length} chars`);
  console.log(`  Total prompt length: ${prompt.length} chars`);
}

main().catch(console.error);
