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

/** Boxes grow with their text, so the layout must allow for it. A generous estimate: canvas text wraps early. */
const heightOf = (text) => text.split('\n').reduce((h, line) => h + Math.max(1, Math.ceil(line.length / 19)) * 27, 0) + 52

// ---- Meditations: books across, ideas down -----------------------------------------------------------------------------
function meditations(map, sections) {
	const W = 280, COL = 340, GAP = 24, PAD = 30, LANE_GAP = 70
	const books = ROMAN.slice(0, 12)
	const tg = { groups: [], nodes: [], edges: [] }
	const keyOf = (cite) => `m-${cite.replace('.', '-')}`.toLowerCase()
	books.forEach((b, i) => {
		const note = map.placeNotes[b]
		if (note) check(note[0], sections[note[0]], note[1])
		const text = note ? `Book ${b}\n"${note[1]}"` : `Book ${b}`
		tg.nodes.push({ key: `book-${b.toLowerCase()}`, text, box: { x: PAD + i * COL, y: 0, w: W, h: 110 }, style: { color: 'black', fill: 'none', dash: 'solid', geo: 'rectangle' } })
	})
	let y = 190
	for (const theme of map.themes) {
		for (const [cite] of theme.passages) assert.ok(books.includes(cite.split('.')[0]), `${cite}: no such book`)
		const byBook = Object.fromEntries(books.map((b) => [b, theme.passages.filter(([c]) => c.split('.')[0] === b)]))
		const placed = []
		let tallest = 0
		books.forEach((b, i) => {
			let cy = y + 56
			for (const [cite, quote] of byBook[b]) {
				check(cite, sections[cite], quote)
				const text = `${quote}\n${cite}`
				const h = heightOf(text)
				placed.push({ key: keyOf(cite), text, group: theme.key, box: { x: PAD + i * COL, y: cy, w: W, h }, style: { color: theme.color, fill: 'semi', dash: 'solid', geo: 'rectangle' } })
				cy += h + GAP
			}
			tallest = Math.max(tallest, cy - y)
		})
		tg.groups.push({ key: theme.key, label: theme.label, box: { x: 0, y, w: PAD * 2 + 12 * COL - (COL - W), h: tallest + 12 } })
		tg.nodes.push(...placed)
		y += tallest + 12 + LANE_GAP
	}
	const cites = new Set(map.themes.flatMap((t) => t.passages.map(([c]) => c)))
	for (const [a, b, label] of map.links) {
		assert.ok(cites.has(a) && cites.has(b), `link ${a} ${b}`)
		tg.edges.push({ key: `edge:${keyOf(a)}->${keyOf(b)}`, from: keyOf(a), to: keyOf(b), label, style: { color: 'grey', dash: 'solid' } })
	}
	return tg
}

// ---- The Odyssey: chapters down, the story running through them, and links where the telling jumps -------------------------
function odyssey(map, books) {
	const W = 280, COL = 340, GAP = 44, PAD = 30, PER_ROW = 5, FRAME_GAP = 70
	const tg = { groups: [], nodes: [], edges: [] }
	const voyageWide = PAD * 2 + PER_ROW * COL - (COL - W)
	// Telemachus's own story runs down the side, so his journey home doesn't cross the voyage.
	const placeChapter = (chapter, x0, y0, perRow) => {
		const rows = []
		chapter.stops.forEach((stop, i) => (rows[Math.floor(i / perRow)] ??= []).push(stop))
		let cy = y0 + 56
		rows.forEach((row, r) => {
			let tallest = 0
			row.forEach(([key, title, book, quote], i) => {
				check(`Book ${book}`, books[book], quote)
				const text = `${title}\n"${short(quote)}"\nBook ${book}`
				const h = heightOf(text)
				tallest = Math.max(tallest, h)
				// Every other row runs back the other way, so the story snakes and each step stays short.
				const column = r % 2 ? perRow - 1 - i : i
				tg.nodes.push({ key, text, group: chapter.key, box: { x: x0 + PAD + column * COL, y: cy, w: W, h }, style: { color: chapter.color, fill: 'semi', dash: 'solid', geo: 'rectangle' } })
			})
			cy += tallest + GAP
		})
		const wide = Math.max(...rows.map((r) => r.length))
		tg.groups.push({ key: chapter.key, label: chapter.label, box: { x: x0, y: y0, w: PAD * 2 + wide * COL - (COL - W), h: cy - y0 } })
		chapter.stops.forEach(([key], i) => {
			if (i) tg.edges.push({ key: `edge:${chapter.stops[i - 1][0]}->${key}`, from: chapter.stops[i - 1][0], to: key, style: { color: 'black', dash: 'solid' } })
		})
		return cy
	}
	const of = (key) => map.chapters.find((c) => c.key === key)
	let y = 0
	for (const key of ['ithaca', 'away', 'wanderings', 'home']) y = placeChapter(of(key), 0, y, key === 'ithaca' ? 2 : PER_ROW) + FRAME_GAP
	placeChapter(of('search'), voyageWide + 120, 0, 1)
	const keys = new Set(map.chapters.flatMap((c) => c.stops.map((s) => s[0])))
	for (const [a, b, label] of map.links) {
		assert.ok(keys.has(a) && keys.has(b), `link ${a} ${b}`)
		tg.edges.push({ key: `edge:${a}->${b}`, from: a, to: b, label, style: { color: 'grey', dash: 'dotted' } })
	}
	return tg
}

const med = meditations(maps.meditations, longSections(longFile))
const ody = odyssey(maps.odyssey, butlerBooks(butlerFile))
assert.deepEqual(missing, [], `not found word for word:\n  ${missing.join('\n  ')}`)
for (const [name, tg] of [['meditations', med], ['odyssey', ody]]) {
	writeFileSync(`examples/${name}.tg.json`, JSON.stringify(tg, null, 1) + '\n')
	console.log(`ok  ${name}: ${tg.nodes.length} boxes, ${tg.edges.length} arrows, every quotation found`)
	console.log(`    toucan new ${name} --from examples/${name}.tg.json --title ${JSON.stringify(maps[name].title)} --description ${JSON.stringify(maps[name].description)}`)
}
