import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { Descriptor } from './types.js';

export function loadDescriptors(userDescriptors?: Array<string | Descriptor>): Descriptor[] {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  // From src/ go up to project root, then into descriptors/
  const descriptorsDir = join(__dirname, '..', 'descriptors');

  const bundled: Descriptor[] = [
    JSON.parse(readFileSync(join(descriptorsDir, 'oracle-error-docs.json'), 'utf-8')) as Descriptor,
    JSON.parse(readFileSync(join(descriptorsDir, 'oracle-standard-docs.json'), 'utf-8')) as Descriptor,
  ];

  const user: Descriptor[] = [];
  if (userDescriptors) {
    for (const item of userDescriptors) {
      if (typeof item === 'string') {
        user.push(JSON.parse(readFileSync(item, 'utf-8')) as Descriptor);
      } else {
        user.push(item);
      }
    }
  }

  // User descriptors first so they override bundled on first-match
  return [...user, ...bundled];
}

export function matchDescriptor(url: string, descriptors: Descriptor[]): Descriptor | null {
  for (const descriptor of descriptors) {
    const pattern = descriptor.url_pattern;

    // Split on {name} placeholders, escape each literal part, rejoin with capture groups
    const parts = pattern.split(/\{[^}]+\}/);
    const escapedParts = parts.map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const regexStr = '^' + escapedParts.join('(.+)') + '$';

    const regex = new RegExp(regexStr);
    if (regex.test(url)) {
      return descriptor;
    }
  }
  return null;
}
