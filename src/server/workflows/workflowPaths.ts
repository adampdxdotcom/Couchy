import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Resolves server workflow JSON files across tsx dev mode, unit tests, and esbuild prod bundles.
 */
export function resolveServerWorkflowPath(filename: string): string {
  const candidates = [
    path.resolve(__dirname, filename),
    path.resolve(__dirname, 'workflows', filename),
    path.resolve(__dirname, '../workflows', filename),
    path.resolve(process.cwd(), 'src/server/workflows', filename),
    path.resolve(process.cwd(), 'dist-server/workflows', filename),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[0];
}
