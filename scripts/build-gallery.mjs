// Writes the docs gallery from the eval's pictures, so what's shown is what the templates draw today.
//   node scripts/eval-diagrams.mjs --no-routines --no-excalidraw && node scripts/build-gallery.mjs
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TEMPLATES } from '../templates/index.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const assets = join(ROOT, 'website/site/assets/gallery')
mkdirSync(assets, { recursive: true })
const page = [
	'# Gallery',
	'',
	'Every diagram toucan starts from, as it draws them. Each one is ordinary shapes you can change, and these same diagrams are the test set for layout: a change that makes one worse fails the build.',
	'',
	'Start one with `toucan new NAME --template ID`, or from **Start from** on the index page. An agent can see the description behind any of them with `toucan templates show ID`, then draw its own in the same form with `toucan --canvas NAME draw -`.',
	'',
]
for (const t of TEMPLATES) {
	const png = join(ROOT, 'evals/out', `${t.id}.png`)
	if (!existsSync(png)) throw new Error(`no picture for ${t.id}: run the eval first`)
	copyFileSync(png, join(assets, `${t.id}.png`))
	page.push(`## ${t.title}`, '', t.use, '', `![The ${t.title} template, as drawn](assets/gallery/${t.id}.png)`, '', `\`toucan new NAME --template ${t.id}\``, '')
}
writeFileSync(join(ROOT, 'website/content/gallery.md'), page.join('\n'))
console.log(`gallery: ${TEMPLATES.length} templates`)
