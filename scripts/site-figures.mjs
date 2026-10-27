// artoo renders conservative Markdown without images. A paragraph that is only a link
// `[Figure: ALT](assets/NAME.png)` renders as a plain link (a fine fallback); this turns it
// into an <img> in an article-figure. Run after `artoo build website`.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const site = process.argv[2] ?? 'website/site'
const unescape = (s) => s.replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, '&')
const attr = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
let count = 0
for (const f of readdirSync(site).filter((f) => f.endsWith('.html'))) {
	const path = join(site, f)
	const html = readFileSync(path, 'utf8')
	const out = html.replace(/<p><a href="(assets\/[^"]+\.(?:png|jpe?g|webp|svg))">Figure: ([^<]*)<\/a><\/p>/g, (_, src, alt) => {
		count++
		return `<figure class="article-figure"><img src="${src}" alt="${attr(unescape(alt))}" loading="lazy"></figure>`
	})
	if (out !== html) writeFileSync(path, out)
}
console.log(`site-figures: ${count} figure(s)`)
