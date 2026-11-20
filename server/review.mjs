// The review log belongs to one canvas. Producers use opaque routing keys.
// Each mutation is committed by one synchronous rename, including its retry receipt.
import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const protocol = 'toucan.review/1'
const maxImage = 5 << 20
const keyPattern = /^[a-zA-Z0-9][a-zA-Z0-9._:@/-]{0,159}$/
const sha256 = (data) => createHash('sha256').update(data).digest('hex')
export const reviewDir = (dir, canvas) => join(dir, `${canvas}.review`)
export class ReviewError extends Error {
	constructor(status, message) {
		super(message)
		this.status = status
	}
}
const invalid = (message) => { throw new ReviewError(400, message) }
const conflict = (message) => { throw new ReviewError(409, message) }

function key(value, label) {
	if (typeof value !== 'string' || !keyPattern.test(value)) invalid(`invalid ${label}`)
	return value
}

function text(value, label, limit) {
	if (typeof value !== 'string' || !value.trim() || value.length > limit) invalid(`${label} must contain 1–${limit} characters`)
	return value.trim()
}

function point(value) {
	if (!value || ![value.x, value.y].every((n) => Number.isFinite(n) && n >= 0 && n <= 1)) invalid('pin must have x and y between 0 and 1')
	return { x: value.x, y: value.y }
}

function imageType(bytes) {
	if (bytes.length >= 33 && bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) && bytes.toString('ascii', 12, 16) === 'IHDR') return 'image/png'
	if (bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 && bytes.at(-2) === 255 && bytes.at(-1) === 217) return 'image/jpeg'
	if (bytes.length >= 16 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP' && bytes.readUInt32LE(4) === bytes.length - 8) return 'image/webp'
	return null
}

function decodeImage(value) {
	if (typeof value !== 'string' || value.length > Math.ceil(maxImage / 3) * 4) invalid('expected a base64 screenshot up to 5 MiB')
	const bytes = Buffer.from(value, 'base64')
	if (bytes.length > maxImage || bytes.toString('base64') !== value) invalid('expected a base64 screenshot up to 5 MiB')
	const type = imageType(bytes)
	if (!type) invalid('expected a PNG, JPEG or WebP screenshot')
	return { bytes, type, digest: sha256(bytes) }
}

function load(dir) {
	try {
		const state = JSON.parse(readFileSync(join(dir, 'log.json'), 'utf8'))
		if (state.protocol !== protocol) throw new Error('unsupported review log format')
		return state
	} catch (err) {
		if (err.code !== 'ENOENT') throw err
		return { protocol, revisions: [], notes: [], receipts: [] }
	}
}

function replace(path, data) {
	const tmp = `${path}.${randomUUID()}.tmp`
	try {
		writeFileSync(tmp, data, { mode: 0o600, flag: 'wx' })
		renameSync(tmp, path)
	} finally {
		rmSync(tmp, { force: true })
	}
}

export function reviewView(dir, producer) {
	const { protocol, revisions, notes } = load(dir)
	if (producer === null) return { protocol, revisions, notes }
	key(producer, 'producer')
	const byId = new Map(revisions.filter((rev) => rev.producer === producer).map((rev) => [rev.id, rev]))
	return {
		protocol,
		inbox: notes.filter((note) => !note.reply && !note.closedAt && byId.has(note.revision))
			.map((note) => ({ note, revision: byId.get(note.revision) })),
	}
}

function change(state, input, id, at) {
	const { revisions, notes } = state
	if (input.op === 'post') {
		const previous = revisions.findLast((rev) => rev.artifact === input.artifact)
		if ((previous?.id ?? null) !== input.previous) conflict('artifact has moved. Refresh and use its current revision as previous.')
		const revision = { id, at, ...input, number: (previous?.number ?? 0) + 1 }
		delete revision.op
		revisions.push(revision)
		return { revision }
	}

	if (input.op === 'pin') {
		if (!revisions.some((rev) => rev.id === input.revision)) throw new ReviewError(404, 'no such revision')
		const note = { id, at, ...input, reply: null, closedAt: null }
		delete note.op
		notes.push(note)
		return { note }
	}

	const note = notes.find((item) => item.id === input.note)
	if (!note) throw new ReviewError(404, 'no such note')
	if (note.closedAt) conflict('note is closed')
	if (input.op === 'close') {
		note.closedAt = at
		return { note }
	}

	const original = revisions.find((rev) => rev.id === note.revision)
	if (original.producer !== input.producer) throw new ReviewError(403, 'note belongs to another producer')
	if (note.reply) conflict('note already has a reply')
	if (input.replacement) {
		const next = revisions.find((rev) => rev.id === input.replacement)
		if (!next || next.artifact !== original.artifact || next.number <= original.number || next.producer !== input.producer) {
			invalid('replacement must be a later revision of this artifact from the same producer')
		}
	}
	note.reply = { id, at, producer: input.producer, text: input.text, replacement: input.replacement }
	return { note }
}

export function reviewWrite(dir, input) {
	if (!input || input.protocol !== protocol) invalid(`expected protocol ${protocol}`)
	const mutation = key(input.mutation, 'mutation key')
	let normalized, image
	switch (input.op) {
		case 'post':
			image = decodeImage(input.image)
			normalized = {
				op: input.op, artifact: key(input.artifact, 'artifact'), producer: key(input.producer, 'producer'),
				title: text(input.title, 'title', 160), caption: input.caption == null ? null : text(input.caption, 'caption', 2000),
				previous: input.previous === null ? null : key(input.previous, 'previous revision'),
				digest: image.digest, type: image.type,
			}
			break
		case 'pin':
			normalized = {
				op: input.op, revision: key(input.revision, 'revision'), pin: point(input.pin),
				author: text(input.author, 'author', 120), text: text(input.text, 'note', 4000),
			}
			break
		case 'reply':
			normalized = {
				op: input.op, note: key(input.note, 'note'), producer: key(input.producer, 'producer'),
				text: text(input.text, 'reply', 4000), replacement: input.replacement == null ? null : key(input.replacement, 'replacement'),
			}
			break
		case 'close':
			normalized = { op: input.op, note: key(input.note, 'note') }
			break
		default:
			invalid('expected post, pin, reply or close')
	}

	const state = load(dir)
	const hash = sha256(JSON.stringify(normalized))
	const old = state.receipts.find((r) => r.mutation === mutation)
	if (old) {
		if (old.hash !== hash) conflict('mutation key already used for a different operation')
		return { protocol, mutation, ...old.result }
	}
	const id = randomUUID()
	const result = change(state, normalized, id, new Date().toISOString())
	state.receipts.push({ mutation, hash, result })
	mkdirSync(dir, { mode: 0o700, recursive: true })
	if (image) replace(join(dir, image.digest), image.bytes)
	replace(join(dir, 'log.json'), JSON.stringify(state))
	return { protocol, mutation, ...result }
}

export function reviewImage(dir, id) {
	const revision = load(dir).revisions.find((rev) => rev.id === id)
	if (!revision) throw new ReviewError(404, 'no such revision')
	return { bytes: readFileSync(join(dir, revision.digest)), type: revision.type }
}
