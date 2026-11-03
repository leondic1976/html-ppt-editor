/** Writes the published document contract used by tools and LLMs. Run: pnpm schema */
import { writeFileSync } from 'node:fs';
import { deckJsonSchema } from '@hps/import-md-json';

writeFileSync('docs/schema-v2.json', `${JSON.stringify(deckJsonSchema(), null, 2)}\n`);
console.log('docs/schema-v2.json');
