// Builds the two demo canvases in examples/ from examples/maps.json, refusing to write anything unless every quotation
// is found word for word where it's cited. Project Gutenberg's plain text of each book is the source:
//
//   curl -o /tmp/pg15877.txt https://www.gutenberg.org/cache/epub/15877/pg15877.txt   (Meditations, George Long)
//   curl -o /tmp/pg1727.txt  https://www.gutenberg.org/cache/epub/1727/pg1727.txt     (The Odyssey, Samuel Butler)
//   node scripts/build-maps.mjs /tmp/pg15877.txt /tmp/pg1727.txt
//
// Then: toucan new meditations --from examples/meditations.tg.json --title "…"
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'

const maps = JSON.parse(readFileSync('examples/maps.json', 'utf8'))
const [longFile, butlerFile] = process.argv.slice(2)
if (!butlerFile) throw new Error('usage: node scripts/build-maps.mjs LONG.txt BUTLER.txt')

/** Line breaks, curly quotes and editors' footnote marks shouldn't decide whether a quotation matches. */
const norm = (s) =>
	s
		.replace(/\[[A-Z]\]/g, '')
		.replace(/(?<=[a-zA-Z.,;:?!’”])\d+/g, '')
		.replace(/[’‘]/g, "'")
		.replace(/[“”]/g, '"')
		.replace(/\s+/g, ' ')
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII', 'XIX', 'XX', 'XXI', 'XXII', 'XXIII', 'XXIV']
const short = (s) => s.replace(/^\W+/, '').trim()

// ---- Long: "II. Begin…", then "2. …" within a book. The count of each book's sections is the check on the parse. ----
function longSections(file) {
	let text = norm(readFileSync(file, 'utf8'))
	// The book ends where the translator's indexes begin, so a quotation can't be matched against those.
	text = text.slice(text.indexOf('I. From my grandfather Verus'), text.indexOf('INDEXES.'))
	const firsts = { I: 'I. From my grandfather', II: 'II. Begin the morning', III: 'III. We ought to consider', IV: 'IV. That which rules within', V: 'V. In the morning when', VI: 'VI. The substance of the universe', VII: 'VII. What is badness', VIII: 'VIII. This reflection also', IX: 'IX. He who acts unjustly', X: 'X. Wilt thou, then', XI: 'XI. These are the properties', XII: 'XII. All those things' }
	// The standard counts. This etext prints no number for the last section of Book V, which nothing here cites.
	const counts = { I: 17, II: 17, III: 16, IV: 51, V: 36, VI: 59, VII: 75, VIII: 61, IX: 42, X: 38, XI: 39, XII: 36 }
	const books = Object.keys(firsts)
	const sections = {}
	books.forEach((book, b) => {
		const start = text.indexOf(firsts[book])
		const end = b < books.length - 1 ? text.indexOf(firsts[books[b + 1]]) : text.length
		assert.ok(start >= 0 && end > start, `Book ${book} not found`)
		let at = start, n = 1
		for (;;) {
			const next = text.slice(at, end).search(new RegExp(`\\s${n + 1}\\. `))
			if (next < 0) break
			sections[`${book}.${n}`] = text.slice(at, at + next)
			at += next + 1
			n++
		}
		sections[`${book}.${n}`] = text.slice(at, end)
		assert.equal(n, counts[book], `Book ${book}: found ${n} sections`)
	})
	return sections
}

// ---- Butler: the last run of "BOOK I … BOOK XXIV" is the poem; before it is the table of contents. --------------------
function butlerBooks(file) {
	const text = norm(readFileSync(file, 'utf8'))
	const body = text.slice(0, text.indexOf('*** END OF'))
	const starts = ROMAN.map((r) => [...body.matchAll(new RegExp(`\\bBOOK ${r}\\b`, 'g'))].at(-1).index)
	assert.deepEqual(starts, [...starts].sort((a, b) => a - b), 'books in order')
	return Object.fromEntries(ROMAN.map((r, i) => [r, body.slice(starts[i], starts[i + 1] ?? body.length)]))
}

const missing = []
const check = (where, within, quote) => {
	if (!within?.includes(norm(quote))) missing.push(`${where}: ${quote}`)
}

/** Cross-references live in the details card, as jumps: drawn on the canvas, they cut across everything. */
function seeAlso(tg, links, keyOf) {
	for (const [a, b, label] of links) {
		const from = tg.nodes.find((n) => n.key === keyOf(a)), to = tg.nodes.find((n) => n.key === keyOf(b))
		assert.ok(from && to, `link ${a} ${b}`)
		for (const [here, there] of [[from, to], [to, from]]) (here.meta.see ??= []).push({ key: there.key, ...(label && { label }) })
	}
}

const TITLE_ONLY = (color, size = 'm') => ({ color, fill: 'semi', dash: 'solid', geo: 'rectangle', size })

// ---- Meditations: books across, ideas down. Short labels on the boxes; the passage opens on click. ---------------------
function meditations(map, sections) {
	const W = 250, H = 96, COL = 300, GAP = 28, PAD = 40, LANE_GAP = 90
	const books = ROMAN.slice(0, 12)
	const tg = { groups: [], nodes: [], edges: [] }
	const keyOf = (cite) => `m-${cite.replace('.', '-')}`.toLowerCase()
	books.forEach((b, i) => {
		const note = map.placeNotes[b]
		if (note) check(note[0], sections[note[0]], note[1])
		tg.nodes.push({ key: `book-${b.toLowerCase()}`, text: `Book ${b}`, box: { x: PAD + i * COL, y: 0, w: W, h: 64 }, style: { color: 'black', fill: 'none', dash: 'solid', geo: 'rectangle', size: 'm' }, ...(note && { meta: { detail: `"${note[1]}" (${note[0]})` } }) })
	})
	let y = 150
	for (const theme of map.themes) {
		for (const [cite] of theme.passages) assert.ok(books.includes(cite.split('.')[0]), `${cite}: no such book`)
		const byBook = Object.fromEntries(books.map((b) => [b, theme.passages.filter(([c]) => c.split('.')[0] === b)]))
		let tallest = 0
		books.forEach((b, i) => {
			let cy = y + 60
			for (const [cite, quote, label] of byBook[b]) {
				check(cite, sections[cite], quote)
				tg.nodes.push({ key: keyOf(cite), text: `${label}\n${cite}`, group: theme.key, box: { x: PAD + i * COL, y: cy, w: W, h: H }, style: TITLE_ONLY(theme.color), meta: { detail: `"${quote}"\n\n${cite}, tr. George Long` } })
				cy += H + GAP
			}
			tallest = Math.max(tallest, cy - y)
		})
		tg.groups.push({ key: theme.key, label: theme.label, box: { x: 0, y, w: PAD * 2 + 12 * COL - (COL - W), h: tallest + 16 } })
		y += tallest + 16 + LANE_GAP
	}
	seeAlso(tg, map.links, keyOf)
	return tg
}

// ---- The Odyssey: one path in the order the poem tells it, with room beside each stop for what questions turn up --------
function odyssey(map, books) {
	const W = 400, H = 150, COL = 600, ROW = 440, PER_ROW = 5
	const tg = { groups: [], nodes: [], edges: [] }
	map.chapters.forEach((c, i) => tg.nodes.push({ key: `chapter-${c.key}`, text: c.label, box: { x: i * COL, y: -260, w: W + 80, h: 120 }, style: { color: c.color, fill: 'solid', dash: 'solid', geo: 'rectangle', size: 'l' } }))
	const path = map.chapters.flatMap((c) => c.stops.map((stop) => ({ c, stop })))
	path.forEach(({ c, stop: [key, title, book, quote] }, i) => {
		check(`Book ${book}`, books[book], quote)
		const row = Math.floor(i / PER_ROW)
		// Every other row runs back the other way, so the story snakes and each step stays short.
		const column = row % 2 ? PER_ROW - 1 - (i % PER_ROW) : i % PER_ROW
		tg.nodes.push({ key, text: `${title}\nBook ${book}`, box: { x: column * COL, y: row * ROW, w: W, h: H }, style: TITLE_ONLY(c.color, 'xl'), meta: { detail: `"${short(quote)}"\n\nBook ${book}, tr. Samuel Butler` } })
		if (i) tg.edges.push({ key: `edge:${path[i - 1].stop[0]}->${key}`, from: path[i - 1].stop[0], to: key, style: { color: c.color, dash: 'solid', size: 'm' } })
	})
	seeAlso(tg, map.links, (key) => key)
	return tg
}

const med = meditations(maps.meditations, longSections(longFile))
const ody = odyssey(maps.odyssey, butlerBooks(butlerFile))
assert.deepEqual(missing, [], `not found word for word:\n  ${missing.join('\n  ')}`)
for (const [name, tg] of [['meditations', med], ['odyssey', ody]]) {
	const keys = tg.edges.map((e) => e.key)
	assert.equal(new Set(keys).size, keys.length, `${name}: an arrow is defined twice, and the later one would win`)
	writeFileSync(`examples/${name}.tg.json`, JSON.stringify(tg, null, 1) + '\n')
	console.log(`ok  ${name}: ${tg.nodes.length} boxes, ${tg.edges.length} arrows, every quotation found`)
	console.log(`    toucan new ${name} --from examples/${name}.tg.json --title ${JSON.stringify(maps[name].title)} --description ${JSON.stringify(maps[name].description)} --canvas-format ${maps[name].format}`)
}
