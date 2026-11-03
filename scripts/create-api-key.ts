/**
 * Crea una clave para la API B2B. La clave se muestra UNA vez; en D1 queda solo su hash.
 *   npm run api-key -- --client "Supermercado X" [--quota 50000] [--remote]
 */
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sha256Hex } from '../src/lib/api-keys';
import { d1ApplyFile } from './d1';
import { sqlLiteral } from './sql';

const args = process.argv.slice(2);
const option = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const client = option('--client')?.trim();
const quota = Number(option('--quota') ?? 10000);
if (!client) {
  console.error('Uso: npm run api-key -- --client "Nombre del cliente" [--quota 10000] [--remote]');
  process.exit(1);
}

const key = `sp_${randomBytes(24).toString('base64url')}`;
const hash = await sha256Hex(key);
const dir = mkdtempSync(join(tmpdir(), 'sanopasillo-'));
const file = join(dir, 'api-key.sql');
try {
  writeFileSync(
    file,
    `INSERT INTO api_keys (key_hash, client_name, monthly_quota) VALUES (${sqlLiteral(hash)}, ${sqlLiteral(client)}, ${quota});`,
  );
  d1ApplyFile(file, args.includes('--remote'));
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log(`\nClave para "${client}" (cuota ${quota}/mes). Guárdala ahora, no se vuelve a mostrar:\n\n  ${key}\n`);
