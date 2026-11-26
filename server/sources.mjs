// Plan sources: where a canvas's plan comes from, and where a person's edits to it go. toucan knows nothing about any
// project-management system; a source speaks for one.
//
//   - `file`: built in. A `toucan.plan/1` JSON file in the canvas's files folder (`files/PATH`) or its linked project
//     (`project/PATH`). Writing rewrites the file, so a plan works with nothing else installed.
//   - any program on PATH named `toucan-source-NAME`, found under the same rule as agent profiles (server/profiles.mjs):
//
//       toucan-source-NAME list                         -> {"sources": [{"ref", "title", "description"?}]}
//       toucan-source-NAME read -- REF                  -> a plan
//       toucan-source-NAME changes --after CUR -- REF   -> {"cursor": CUR2, "changed": true|false}
//       toucan-source-NAME write -- REF  < {"changes"}  -> {"cursor", "results"}
//
//     JSON on stdout and exit 0; on failure a non-zero exit and one JSON object on stderr, {"error": CODE, "message": TEXT}
//     (plain text is tolerated). Codes: not_found, invalid, conflict, forbidden, unavailable.
//
//     A REF comes from outside (a binding anyone who reaches the server can make), so it must never be read as an option:
//     it is always the one argument after `--`, and one that starts with `-` is refused before anything runs. A cursor is
//     the value of `--after`, as `--after=CUR` when it starts with `-`.
//
// A source is never run through a shell, and every call has a time limit. The plan format and the rules of a write are in
// lib/plan.mjs; website/content/extending.md documents the whole protocol.

import { createHash, randomBytes } from 'node:crypto'
import { closeSync, existsSync, fchmodSync, lstatSync, openSync, readdirSync, readFileSync, renameSync, rmSync, writeSync } from 'node:fs'
import { join } from 'node:path'
import { PlanError, applyChanges, checkPlan } from '../lib/plan.mjs'
import { KINDS, createPlugins } from './plugins.mjs'
import { resolveRef } from './references.mjs'

const PREFIX = KINDS.source.prefix
const NAME = /^[a-z0-9][a-z0-9_-]{0,63}$/i
const TIMEOUT = { list: 15000, read: 30000, changes: 8000, write: 30000 }

export { PlanError as SourceError }

/** A ref as an adapter may be given it: text, and nothing a program could take for an option. */
function checkRef(ref) {
	if (typeof ref !== 'string' || !ref) throw new PlanError('invalid', `a plan's ref is text that names it in its source: got ${JSON.stringify(ref) ?? typeof ref}`)
	if (ref.startsWith('-')) throw new PlanError('invalid', `a plan's ref can't start with "-" (a program would read it as an option): got ${JSON.stringify(ref)}`)
	return ref
}

function commandSource(plugins, plugin) {
	const name = plugin.id, command = plugin.command
	// A plugin's failure (server/plugins.mjs) is a plan's failure, with the same code.
	const call = (verb, args, input) => plugins.call(plugin, [verb, ...args], { input, timeout: TIMEOUT[verb] }).catch((e) => {
		throw new PlanError(e.code ?? 'unavailable', e.message)
	})
	return {
		name,
		kind: 'command',
		command,
		async list() {
			const r = await call('list', [])
			return (Array.isArray(r?.sources) ? r.sources : []).filter((s) => s && typeof s.ref === 'string').map((s) => ({ ref: s.ref, title: String(s.title ?? s.ref), ...(s.description && { description: String(s.description) }) }))
		},
		read: async (ref) => checkPlan(await call('read', ['--', checkRef(ref)])),
		async changes(ref, cursor) {
			const after = String(cursor ?? '')
			// The cursor is the source's own text. As `--after=CUR` it can't be taken for an option either.
			const r = await call('changes', [...(after.startsWith('-') ? [`--after=${after}`] : ['--after', after]), '--', checkRef(ref)])
			return { cursor: String(r?.cursor ?? cursor ?? ''), changed: r?.changed !== false }
		},
		async write(ref, changes) {
			const r = await call('write', ['--', checkRef(ref)], JSON.stringify({ changes }))
			if (!Array.isArray(r?.results)) throw new PlanError('invalid', `${PREFIX}${name} write didn't answer with "results"`)
			return { cursor: r.cursor === undefined || r.cursor === null ? null : String(r.cursor), results: r.results }
		},
	}
}

// ---- the file source ------------------------------------------------------------------------------------------------------

const cursorOf = (text) => createHash('sha1').update(text).digest('hex').slice(0, 16)

/**
 * `roots(canvas)` gives the folders a canvas may read (server/references.mjs): its files folder, and its linked project.
 * The file is the system of record: item versions are integers this source bumps, the cursor is a hash of the file,
 * and the last 200 idempotency keys are kept in the file under "mutations".
 *
 * `seams.beforeReplace(path)` runs between writing the new text beside the file and putting it in its place: tests use it
 * to change the file under a write.
 */
function fileSource(roots, seams = {}) {
	const locate = (ref, canvas) => {
		checkRef(ref)
		if (!canvas) throw new PlanError('invalid', 'the file source reads a file beside a canvas: name the canvas')
		const file = resolveRef(ref, roots(canvas).filter((r) => r.id === 'files' || r.id.startsWith('project')))
		if (file.error) throw new PlanError(/no such file/.test(file.error) ? 'not_found' : 'invalid', `${file.error}. A file plan is files/PATH (this canvas's files folder) or project/PATH (its linked project).`)
		return file.path
	}
	const load = (path) => {
		let text
		try {
			text = readFileSync(path, 'utf8')
		} catch (e) {
			throw new PlanError('not_found', `can't read ${path}: ${e.message}`)
		}
		let raw
		try {
			raw = JSON.parse(text)
		} catch (e) {
			throw new PlanError('invalid', `${path} isn't JSON: ${e.message}`)
		}
		return { text, raw }
	}
	const planOf = (ref, { text, raw }) => {
		const plan = checkPlan(raw)
		return { ...plan, source: { ...plan.source, ref, title: raw.source?.title ?? ref.split('/').pop().replace(/(\.plan)?\.json$/, '') }, cursor: cursorOf(text) }
	}
	/**
	 * Puts `text` where `path` is. `path` is where the ref led a moment ago, and an agent can write in these folders: by
	 * now the ref could be a link to a file somewhere else. So the text goes into a new file beside it (never one that is
	 * already there, link or not), the ref is followed again, and only if it still leads to the same file, itself no link,
	 * does the new one take its name. A rename replaces the name and never follows a link at it.
	 */
	const replace = (ref, canvas, path, text) => {
		const mode = lstatSync(path).mode & 0o777
		const tmp = `${path}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`
		const fd = openSync(tmp, 'wx', mode)
		let open = true
		try {
			writeSync(fd, text)
			fchmodSync(fd, mode) // the mode it had, whatever the umask
			closeSync(fd)
			open = false
			seams.beforeReplace?.(path)
			let now = null, why = 'it is no longer the same file'
			try {
				now = locate(ref, canvas)
			} catch (e) {
				why = e.message
			}
			if (now !== path || !lstatSync(path).isFile()) throw new PlanError('conflict', `${ref} was replaced on disk while it was being written, so nothing was written: ${why}`)
			renameSync(tmp, path)
		} catch (e) {
			if (open) closeSync(fd)
			rmSync(tmp, { force: true })
			throw e
		}
	}
	return {
		name: 'file',
		kind: 'builtin',
		async list(canvas) {
			if (!canvas) return []
			const out = []
			const walk = (root, dir, prefix, depth) => {
				let entries
				try {
					entries = readdirSync(dir, { withFileTypes: true })
				} catch {
					return
				}
				for (const e of entries) {
					if (e.name.startsWith('.') || e.name === 'node_modules' || out.length >= 100) continue
					if (e.isDirectory() && depth < 3) walk(root, join(dir, e.name), `${prefix}${e.name}/`, depth + 1)
					else if (e.isFile() && /(^|\.)plan\.json$/.test(e.name)) {
						try {
							const raw = JSON.parse(readFileSync(join(dir, e.name), 'utf8'))
							if (raw?.plan === 1) out.push({ ref: `${root.id}/${prefix}${e.name}`, title: String(raw.source?.title ?? e.name) })
						} catch {}
					}
				}
			}
			for (const root of roots(canvas)) if ((root.id === 'files' || root.id.startsWith('project')) && existsSync(root.dir)) walk(root, root.dir, '', 0)
			return out
		},
		read: async (ref, canvas) => planOf(ref, load(locate(ref, canvas))),
		async changes(ref, cursor, canvas) {
			const now = cursorOf(load(locate(ref, canvas)).text)
			return { cursor: now, changed: now !== String(cursor ?? '') }
		},
		async write(ref, changes, canvas) {
			const path = locate(ref, canvas)
			const loaded = load(path)
			const plan = planOf(ref, loaded)
			const { plan: next, results, seen, changed } = applyChanges(plan, changes, loaded.raw.mutations && typeof loaded.raw.mutations === 'object' ? loaded.raw.mutations : {})
			let text = loaded.text
			if (changed || Object.keys(seen).length !== Object.keys(loaded.raw.mutations ?? {}).length) {
				// Everything the file said stays, in its order: only the items and the idempotency keys are rewritten.
				const { cursor, ...kept } = loaded.raw
				text = JSON.stringify({ ...kept, fields: loaded.raw.fields ?? plan.fields, items: next.items, mutations: seen }, null, 2) + '\n'
				replace(ref, canvas, path, text)
			}
			return { cursor: cursorOf(text), results }
		},
	}
}

/**
 * The sources on this machine. `roots(canvas)` is what the file source may read; adapters are the `source` plugins that
 * `plugins` (server/plugins.mjs) finds, or, given none, ones looked for with `data`, `exclude` and `path`. `seams` is for
 * tests (see fileSource).
 */
export function createSources({ data, exclude = [], roots, path, plugins = createPlugins({ data, exclude, path, ttl: 0 }), seams }) {
	const file = fileSource(roots, seams)
	function get(name) {
		if (name === 'file') return file
		if (String(name ?? '').startsWith('-')) throw new PlanError('invalid', `a source's name can't start with "-": got ${JSON.stringify(name)}`)
		if (!NAME.test(String(name ?? ''))) throw new PlanError('invalid', `a source's name is letters, digits, - and _: got ${JSON.stringify(name)}`)
		const found = plugins.get('source', name)
		if (!found) throw new PlanError('not_found', `no plan source "${name}": ${plugins.whyNot('source', name)}. \`toucan plugins\` lists what was found and what was refused.`)
		return commandSource(plugins, found)
	}
	/** Every source, with the plans each can list. One that fails is reported, and the others still list. */
	async function list(canvas) {
		const all = [file, ...plugins.of('source', { fresh: true }).map((p) => commandSource(plugins, p))]
		return Promise.all(all.map(async (s) => {
			const row = { name: s.name, kind: s.kind, ...(s.command && { command: s.command }) }
			try {
				return { ...row, refs: await s.list(canvas) }
			} catch (e) {
				return { ...row, refs: [], error: String(e.message ?? e) }
			}
		}))
	}
	return { get, list }
}
