import { readFileSync } from 'node:fs';
import path from 'node:path';
import { packageRoot } from './paths';

export const VERSION: string = JSON.parse(
  readFileSync(path.join(packageRoot(), 'package.json'), 'utf8'),
).version;
