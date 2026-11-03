/** Utilidades para que los scripts lean y escriban D1 (local o remota) a través de wrangler. */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const DB_NAME = 'sanopasillo-db';

function wrangler(args: string[], capture: boolean): string {
  return execFileSync('npx', ['wrangler', 'd1', 'execute', DB_NAME, ...args], {
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
    shell: process.platform === 'win32',
    maxBuffer: 256 * 1024 * 1024,
  }) as unknown as string;
}

/** SELECT en D1. El SQL va por archivo para no pelear con el quoting de la shell. */
export function d1Query<T>(sql: string, remote: boolean): T[] {
  const dir = mkdtempSync(join(tmpdir(), 'sanopasillo-'));
  const file = join(dir, 'query.sql');
  try {
    writeFileSync(file, sql);
    const out = wrangler([remote ? '--remote' : '--local', '--json', `--file=${file}`], true);
    const parsed = JSON.parse(out.slice(out.indexOf('['))) as { results?: T[] }[];
    return parsed.flatMap((r) => r.results ?? []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function d1ApplyFile(file: string, remote: boolean): void {
  wrangler([remote ? '--remote' : '--local', `--file=${file}`], false);
}
