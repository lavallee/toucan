// Release hygiene: versions agree everywhere, and no internal names reach the public repo or site.
//   node scripts/check-repo.mjs [DIR...]   (default: the tracked files; pass website/site to check a build)
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const json = (f) => JSON.parse(readFileSync(f, 'utf8'))
const version = json('package.json').version
for (const f of ['.claude-plugin/plugin.json', '.codex-plugin/plugin.json']) assert.equal(json(f).version, version, `${f} version`)
assert.match(readFileSync('CHANGELOG.md', 'utf8'), new RegExp(`## \\[${version.replaceAll('.', '\\.')}\\]`), 'CHANGELOG has this version')
assert.match(readFileSync('skills/toucan/SKILL.md', 'utf8'), /^---\nname: toucan\ndescription: .+\n---\n/, 'SKILL.md frontmatter')
console.log(`ok  version ${version} in package.json, both plugin manifests and CHANGELOG`)

// Hostnames, services and projects from the deployment toucan grew up in. Keep it current.
const INTERNAL = /\b(lisbon|dash-main|lyra\.internal|harbor|george|delphi|weaver|estate|tailnet)\b|\b100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d+\.\d+\b/i
const walk = (p) => (statSync(p).isDirectory() ? readdirSync(p).flatMap((f) => walk(join(p, f))) : [p])
const files = process.argv.length > 2 ? process.argv.slice(2).flatMap(walk) : execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' }).split('\n').filter(Boolean)
const hits = []
for (const f of files) {
	if (f === 'package-lock.json' || f === 'scripts/check-repo.mjs' || /\.(png|ico|woff2?|ttf)$/.test(f)) continue
	readFileSync(f, 'utf8').split('\n').forEach((line, i) => INTERNAL.test(line) && hits.push(`${f}:${i + 1}: ${line.trim().slice(0, 120)}`))
}
assert.deepEqual(hits, [], `internal names found:\n${hits.join('\n')}`)
console.log(`ok  no internal names in ${files.length} files`)
