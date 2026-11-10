import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
// Storage and override order shared by canvas JavaScript routines and page
// prompt routines. Hosts retain their own parsers, validation and execution.
export function createRoutineBank({ shipped, banked, extension, parse, compose }) {
  const scan = (dir, source) => dir && existsSync(dir) ? readdirSync(dir).filter(f => f.endsWith(extension)).map(f => ({ ...parse(f.slice(0, -extension.length), readFileSync(join(dir, f), 'utf8')), source })) : [];
  const valid = name => { if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(name)) throw new Error('Invalid routine name.'); };
  return {
    list() { return [...new Map([...scan(shipped, 'shipped'), ...scan(banked, 'banked')].map(r => [r.name, r])).values()].sort((a,b) => a.title.localeCompare(b.title)); },
    save(name, parts) { valid(name); mkdirSync(banked, { recursive: true, mode: 0o700 }); const file = join(banked, name + extension); writeFileSync(file + '.tmp', compose(parts), { mode: 0o600 }); renameSync(file + '.tmp', file); return parse(name, readFileSync(file, 'utf8')); },
  };
}
