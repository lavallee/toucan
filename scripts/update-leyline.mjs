// Pins a new version of the shared UI and agent package (@lyra-forge/leyline) from a
// checkout of its repository: packs it, vendors the tarball beside its provenance and
// installs it as a build-time dependency. The app bundles it; a release ships the bundle.
//   node scripts/update-leyline.mjs --source /absolute/path/to/leyline
import { parseArgs } from 'node:util'
import { execFileSync } from 'node:child_process'
import { readFile, writeFile, mkdir, copyFile, readdir, rm, mkdtemp } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import path from 'node:path'

const { values } = parseArgs({ options: { source: { type: 'string' } } })
if (!values.source || !path.isAbsolute(values.source)) throw new Error('Pass --source /absolute/path/to/leyline')
const source = values.source
const git = (...args) => execFileSync('git', args, { cwd: source, encoding: 'utf8' }).trim()
if (path.resolve(git('rev-parse', '--show-toplevel')) !== path.resolve(source)) throw new Error('Pass the root of the leyline repository.')
if (git('status', '--porcelain', '--untracked-files=all')) throw new Error('Commit the package changes before pinning its revision.')
const revision = git('rev-parse', 'HEAD')
let remote = ''
try {
	remote = git('remote', 'get-url', 'origin')
} catch {}
const scratch = await mkdtemp(path.join(tmpdir(), 'leyline-pack-'))
const [packed] = JSON.parse(execFileSync('npm', ['pack', '.', '--pack-destination', scratch, '--json'], { cwd: source, encoding: 'utf8' }))
await mkdir('vendor', { recursive: true })
for (const old of await readdir('vendor')) if (/^lyra-forge-leyline-.*\.tgz$/.test(old) && old !== packed.filename) await rm(path.join('vendor', old))
await copyFile(path.join(scratch, packed.filename), path.join('vendor', packed.filename))
await rm(scratch, { recursive: true, force: true })
const bytes = await readFile(path.join('vendor', packed.filename))
await writeFile('vendor/leyline.json', JSON.stringify({ name: packed.name, version: packed.version, source: remote || 'local repository "leyline"', revision, artifact: packed.filename, integrity: 'sha512-' + createHash('sha512').update(bytes).digest('base64') }, null, 2) + '\n')
execFileSync('npm', ['install', '--save-dev', `./vendor/${packed.filename}`], { stdio: 'inherit' })
console.log(`Pinned ${packed.name} ${packed.version} at ${revision.slice(0, 12)}.`)
