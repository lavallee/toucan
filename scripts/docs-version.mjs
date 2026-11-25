// The package version owns the human-readable release link, including builds served offline.
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
const page = new URL('../website/content/index.md', import.meta.url)
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)))
const source = readFileSync(page, 'utf8')
const links = [...source.matchAll(/<a data-release href="[^"]+">[^<]*<\/a>/g)]
assert.equal(links.length, 1, 'Homepage must have exactly one visible release link')
const link = `<a data-release href="https://github.com/lavallee/toucan/releases/tag/v${version}">Toucan v${version}</a>`
if (process.argv.includes('--write')) {
	if (links[0][0] !== link) writeFileSync(page, source.replace(links[0][0], link))
} else assert.equal(links[0][0], link, 'Homepage version is stale. Run npm run docs:version.')
