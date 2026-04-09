/**
 * Custom descriptor — demonstrate adding a new documentation source.
 *
 * This example shows how the extraction engine works with any descriptor,
 * not just the bundled Oracle ones. You can point it at any documentation
 * site by defining the CSS selectors and extraction rules.
 *
 * Run: npx tsx Samples/custom-descriptor.ts
 */
import Distill from 'distill';
import type { Descriptor } from 'distill';

// Example: a hypothetical descriptor for a custom error docs site.
// In practice you'd save this as a .json file and pass the path.
const myDescriptor: Descriptor = {
  name: 'my-error-docs',
  version: '1.0',
  description: 'Custom error documentation',
  url_pattern: 'https://errors.example.com/{code}/',
  base_url: 'https://errors.example.com/',
  root: 'body',
  fields: {
    title: {
      selector: 'h1',
      extract: 'text',
      required: true,
    },
    description: {
      selector: '.error-description',
      extract: 'text',
    },
    solution: {
      heading: 'Solution',
      heading_tag: 'h2',
      content_selector: 'div.content',
      extract: 'heading_section',
      content_extract: 'prose',
    },
  },
  metadata: {
    url: {
      source: 'input_url',
    },
  },
};

async function main() {
  // Pass custom descriptors alongside the bundled ones
  const client = new Distill({
    descriptors: [myDescriptor],
  });

  console.log('Custom descriptor loaded: my-error-docs');
  console.log('URL pattern:', myDescriptor.url_pattern);
  console.log('Fields:', Object.keys(myDescriptor.fields).join(', '));
  console.log();
  console.log('The client will now try to match URLs against this descriptor');
  console.log('before falling back to the bundled Oracle descriptors.');
  console.log();
  console.log('To use it, call client.extract() with a URL that matches the pattern:');
  console.log('  const data = await client.extract("https://errors.example.com/ERR-001/")');
}

main().catch(console.error);
