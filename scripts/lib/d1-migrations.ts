import fs from 'node:fs';
import path from 'node:path';

export function readCanonicalMigrations(root: string): string {
  const directory = path.join(root, 'data/d1/migrations');
  return fs.readdirSync(directory)
    .filter(file => /^\d+_.+\.sql$/.test(file))
    .sort()
    .map(file => fs.readFileSync(path.join(directory, file), 'utf8'))
    .join('\n');
}
