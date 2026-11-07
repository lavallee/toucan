// Renders website/work/features.json, the full list of what toucan does, to website/content/features.md for the docs site.
// The JSON is the source: keep it in step with CHANGELOG.md, and other tools can read it too.
//
//   node scripts/build-features.mjs        (run by `npm run docs` before `artoo build website`)
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const data = JSON.parse(readFileSync(join(ROOT, 'website/work/features.json'), 'utf8'))
const cell = (s) => String(s ?? '').replace(/\|/g, '\\|')
const code = (s) => (s ? s.split(' · ').map((c) => '`' + c.replace(/`/g, '') + '`').join(' · ') : '')
const where = (f) => [f.app && `**${f.app}**`, f.cli && `CLI: ${code(f.cli)}`].filter(Boolean).join('; ') || '—'
const name = (f) => (f.docs ? `[${f.name}](${f.docs})` : f.name) + (f.engines === 'tldraw' ? ' (tldraw)' : '')

const out = [
	'---',
	`description: Everything toucan ${data.version} does, in one list: where to find each feature, and when it arrived.`,
	'kicker: Reference',
	'---',
	'# Features',
	'',
	`Each row says where you find it: in the app, or as a \`toucan\` command an agent (or you) runs. Names link to where it's shown or explained, and "(tldraw)" marks what works on the tldraw engine only.`,
	'',
]
for (const g of data.groups) {
	const rows = data.features.filter((f) => f.group === g.id)
	if (!rows.length) continue
	out.push(`## ${g.name}`, '', '| Feature | What it does | Where | Since |', '|---|---|---|---:|')
	for (const f of rows) out.push(`| ${cell(name(f))} | ${cell(f.summary)} | ${cell(where(f))} | ${f.since ?? ''} |`)
	out.push('')
}
out.push(`*${data.features.length} features. The list is built from \`website/work/features.json\`; [the changelog](https://github.com/lavallee/toucan/blob/main/CHANGELOG.md) has the detail.*`, '')
writeFileSync(join(ROOT, 'website/content/features.md'), out.join('\n'))
console.log(`features.md: ${data.features.length} features in ${data.groups.length} groups`)
