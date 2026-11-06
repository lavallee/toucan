// Agent profiles: a named agent people work with on a canvas, with its own knowledge, briefing and skills. A canvas bound
// to a profile has that agent in its chat panel and its comment threads, instead of toucan's general-purpose one.
//
// Profiles come from sources:
//   - local: one JSON file per profile in <data>/_profiles/ (`kiefer.json` is `local/kiefer`);
//   - any program on PATH named `toucan-profiles-NAME`, which answers `list` and `get ID` with JSON. That's how a registry
//     plugs in without toucan knowing about it: `toucan-profiles-acme get kiefer` is the profile `acme/kiefer`.
//
// A profile (schema toucan.profile/1):
//   { id, name, description?, color?,
//     workdir,                      the agent's own folder: its repository, notebook, memory. Absolute.
//     instructions,                 who it is and how it works, in its own words. Becomes part of its instructions.
//     context: [{ path, label? } | { text, label }],   read at the start of each conversation, within `budget` characters
//     skills: [{ name, description, path }],           SKILL.md files it may open when one applies
//     references: [path | { path, label }],            folders people may read in the References panel, as agent/…
//     model?, budget? }
// Paths are relative to workdir. Context and references must be inside it, and not hidden. A profile grants no writing:
// the agent writes in the canvas's files folder like any chat agent, because a profile can be bound by anyone who can
// reach the server, the chat agent included, and must not be a way to widen its own sandbox.
// Anything a source says is checked here, and a missing file is reported rather than skipped silently.

import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { accessSync, constants, existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)
const ID = /^[a-z0-9][a-z0-9_-]{0,63}$/i
const PREFIX = 'toucan-profiles-'
const DEFAULT_BUDGET = 24000, MAX_BUDGET = 80000, MAX_FILE = 4 << 20

export class ProfileError extends Error {}

/** The sources on this machine: local files, and every toucan-profiles-NAME program on PATH. */
export function findSources({ data, path = process.env.PATH ?? '', exclude = [] }) {
	const sources = [{ id: 'local', kind: 'files', dir: join(data, '_profiles') }]
	const seen = new Set(['local'])
	// The server runs a source outside any sandbox, so it only looks where an agent can't put one: not a relative folder,
	// not inside toucan or its data (where agents write, and where npm puts node_modules/.bin on PATH), and nothing
	// anyone else can write to.
	const fenced = [data, ...exclude].filter(Boolean).map((d) => (existsSync(d) ? realpathSync(d) : resolve(d)))
	const inside = (p) => fenced.some((f) => p === f || p.startsWith(f + sep))
	const openToOthers = (p) => (statSync(p).mode & 0o022) !== 0
	for (const dir of path.split(delimiter).filter((d) => d && isAbsolute(d))) {
		let real
		try {
			real = realpathSync(dir)
			if (inside(real) || openToOthers(real)) continue
		} catch {
			continue
		}
		let names
		try {
			names = readdirSync(dir)
		} catch {
			continue
		}
		for (const file of names) {
			if (!file.startsWith(PREFIX)) continue
			const id = file.slice(PREFIX.length).replace(/\.(m?js|py|sh|exe|cmd)$/i, '')
			if (!ID.test(id) || seen.has(id)) continue
			const full = join(dir, file)
			try {
				accessSync(full, constants.X_OK)
				const target = realpathSync(full)
				if (!statSync(target).isFile() || inside(target) || openToOthers(target)) continue
			} catch {
				continue
			}
			seen.add(id)
			sources.push({ id, kind: 'command', command: full })
		}
	}
	return sources
}

async function ask(source, args, timeout = 15000) {
	try {
		const { stdout } = await run(source.command, args, { timeout, maxBuffer: 4 << 20, env: { ...process.env, TOUCAN_PROFILES_PROTOCOL: '1' } })
		return JSON.parse(stdout)
	} catch (e) {
		const why = e.killed ? 'took too long' : e instanceof SyntaxError ? "didn't answer with JSON" : String(e.stderr || e.message).trim().split('\n')[0]
		throw new ProfileError(`${PREFIX}${source.id} ${args.join(' ')}: ${why}`)
	}
}

const str = (v, max = 400) => (typeof v === 'string' ? v.slice(0, max) : undefined)
const summary = (source, p) => ({ ref: `${source.id}/${p.id}`, source: source.id, id: p.id, name: str(p.name, 60) || p.id, description: str(p.description) ?? '', ...(str(p.color, 20) && { color: str(p.color, 20) }) })

/** Every profile every source offers. A source that fails is reported, and the others still list. */
export async function listProfiles(sources) {
	const out = { profiles: [], errors: [] }
	for (const source of sources) {
		try {
			let list = []
			if (source.kind === 'files') {
				if (!existsSync(source.dir)) continue
				list = readdirSync(source.dir).filter((f) => f.endsWith('.json')).flatMap((f) => {
					try {
						return [{ id: f.slice(0, -5), ...JSON.parse(readFileSync(join(source.dir, f), 'utf8')) }]
					} catch (e) {
						out.errors.push({ source: source.id, error: `${f}: ${e.message}` })
						return []
					}
				})
			} else list = (await ask(source, ['list'])).profiles ?? []
			for (const p of list) if (p && ID.test(String(p.id))) out.profiles.push(summary(source, p))
		} catch (e) {
			out.errors.push({ source: source.id, error: String(e.message ?? e) })
		}
	}
	return out
}

/** One profile, by `source/id`, checked and with its starting context read. */
export async function getProfile(ref, sources) {
	const [sid, id, ...rest] = String(ref).split('/')
	if (rest.length || !ID.test(sid ?? '') || !ID.test(id ?? '')) throw new ProfileError(`a profile is SOURCE/ID, like local/kiefer: ${ref}`)
	const source = sources.find((s) => s.id === sid)
	if (!source) throw new ProfileError(`no profile source ${sid}: sources are ${sources.map((s) => s.id).join(', ')}`)
	let raw
	if (source.kind === 'files') {
		const file = join(source.dir, `${id}.json`)
		if (!existsSync(file)) throw new ProfileError(`no profile ${ref}: put one in ${file}`)
		try {
			raw = JSON.parse(readFileSync(file, 'utf8'))
		} catch (e) {
			throw new ProfileError(`${file} isn't valid JSON: ${e.message}`)
		}
	} else raw = await ask(source, ['get', id])
	return checkProfile({ ...raw, id }, `${sid}/${id}`)
}

/** A profile as a source described it, made safe to use: folders that exist, files read within the budget. */
export function checkProfile(raw, ref) {
	if (!raw || typeof raw !== 'object') throw new ProfileError(`${ref}: a profile is a JSON object`)
	const problems = []
	const workdir = typeof raw.workdir === 'string' && isAbsolute(raw.workdir) ? raw.workdir : null
	if (!workdir) throw new ProfileError(`${ref}: workdir must be an absolute path to the agent's folder`)
	if (!existsSync(workdir) || !statSync(workdir).isDirectory()) throw new ProfileError(`${ref}: workdir ${workdir} isn't a folder on this machine`)
	const base = realpathSync(workdir)
	// A whole disk or a home folder isn't an agent's folder: its context could be anyone's keys.
	const home = realpathSync(homedir())
	if (base === sep || home === base || home.startsWith(base + sep)) throw new ProfileError(`${ref}: workdir ${workdir} is too broad; give the agent's own folder`)
	const at = (p) => resolve(base, String(p))
	const within = (full) => {
		const real = existsSync(full) ? realpathSync(full) : full
		return (real === base || real.startsWith(base + sep)) && !relative(base, real).split(sep).some((s) => s.startsWith('.'))
	}
	// What people may read, and what the agent may write, stays inside the agent's own folder: a profile can't hand out
	// the rest of the machine.
	const dirOf = (p, what) => {
		const full = at(p)
		if (!existsSync(full) || !statSync(full).isDirectory()) return void problems.push(`${what} ${p}: not a folder`)
		const real = realpathSync(full)
		if (!within(real)) return void problems.push(`${what} ${p}: outside ${base}, or hidden`)
		return real
	}
	const budget = Math.min(MAX_BUDGET, Math.max(1000, Number(raw.budget) || DEFAULT_BUDGET))
	let left = budget
	const context = []
	for (const c of Array.isArray(raw.context) ? raw.context : []) {
		if (typeof c?.text === 'string') {
			const text = c.text.slice(0, left)
			left -= text.length
			context.push({ label: str(c.label, 120) || 'briefing', text, chars: text.length, truncated: text.length < c.text.length })
			continue
		}
		const path = typeof c === 'string' ? c : c?.path
		if (typeof path !== 'string') continue
		const full = at(path)
		if (!within(full)) {
			problems.push(`context ${path}: outside ${base}, or hidden`)
			continue
		}
		if (!existsSync(full) || !statSync(full).isFile()) {
			problems.push(`context ${path}: no such file`)
			context.push({ label: str(c?.label, 120) || path, path: full, missing: true, chars: 0 })
			continue
		}
		if (statSync(full).size > MAX_FILE) {
			problems.push(`context ${path}: over ${MAX_FILE >> 20} MB, so not read`)
			continue
		}
		const bytes = readFileSync(full)
		const whole = bytes.toString('utf8')
		const text = whole.slice(0, left)
		left -= text.length
		context.push({ label: str(c?.label, 120) || path, path: full, text, chars: text.length, truncated: text.length < whole.length, sha256: createHash('sha256').update(bytes).digest('hex') })
	}
	const skills = []
	for (const s of Array.isArray(raw.skills) ? raw.skills : []) {
		const path = typeof s === 'string' ? s : s?.path
		if (typeof path !== 'string') continue
		const full = at(path)
		const file = existsSync(full) && statSync(full).isDirectory() ? join(full, 'SKILL.md') : full
		if (!existsSync(file)) {
			problems.push(`skill ${path}: no SKILL.md`)
			continue
		}
		// Name and description from the skill's own front matter when the source didn't give them.
		const head = readFileSync(file, 'utf8').slice(0, 2000)
		const fm = (k) => head.match(new RegExp(`^${k}:\\s*(.+)$`, 'm'))?.[1]?.trim()
		skills.push({ name: str(s?.name, 80) || fm('name') || path, description: str(s?.description, 600) || fm('description') || '', path: file })
	}
	const references = (Array.isArray(raw.references) ? raw.references : []).flatMap((r) => {
		const p = typeof r === 'string' ? r : r?.path
		const dir = typeof p === 'string' ? dirOf(p, 'reference') : null
		return dir ? [{ dir, label: str(r?.label, 80) || p }] : []
	})
	if (Array.isArray(raw.writable) && raw.writable.length) problems.push("writable: profiles can't grant writing; the agent writes in the canvas's files folder")
	return {
		ref,
		id: raw.id,
		name: str(raw.name, 60) || raw.id,
		description: str(raw.description) ?? '',
		...(str(raw.color, 20) && { color: str(raw.color, 20) }),
		workdir: base,
		instructions: str(raw.instructions, 20000) ?? '',
		context,
		skills,
		references,
		...(str(raw.model, 80) && { model: str(raw.model, 80) }),
		budget,
		problems,
	}
}

/** What a profile tells its agent, after toucan's own instructions. */
export function profileInstructions(p) {
	const parts = [
		`You are ${p.name}, not a general-purpose assistant: the person chose to work with you on this canvas. Speak as ${p.name}, from what ${p.name} knows and believes, and say plainly when something is outside what you know.`,
		`Your own folder is ${p.workdir}. Read from it with absolute paths, and run your own tools there with \`cd ${p.workdir} && …\`. toucan's commands still run from toucan's folder, as above.`,
		`Your folder is for reading: write only in this canvas's files folder.`,
	]
	if (p.instructions) parts.push(`## Who you are\n\n${p.instructions}`)
	if (p.skills.length) parts.push(`## Your skills\n\nOpen a skill's file and follow it when the work calls for it:\n${p.skills.map((s) => `- ${s.name}: ${s.description} (${s.path})`).join('\n')}`)
	const read = p.context.filter((c) => c.text)
	if (read.length) parts.push(`## What you know at the start\n\nRead before this conversation began; go back to the files for more.\n\n${read.map((c) => `### ${c.label}${c.path ? ` (${c.path})` : ''}${c.truncated ? ' (cut short)' : ''}\n\n${c.text}`).join('\n\n')}`)
	const missing = p.context.filter((c) => c.missing)
	if (missing.length) parts.push(`These were meant to be in your starting context but weren't found: ${missing.map((c) => c.label).join(', ')}.`)
	return parts.join('\n\n')
}

/** Lookups for the server: sources found once a minute, profiles kept for a short while. */
export function createProfiles({ data, exclude = [], ttl = 60000 }) {
	let sources = null, found = 0
	const cache = new Map()
	const current = () => {
		if (!sources || Date.now() - found > ttl) (sources = findSources({ data, exclude })), (found = Date.now())
		return sources
	}
	return {
		sources: current,
		list: () => listProfiles(current()),
		async get(ref, { fresh = false } = {}) {
			const hit = cache.get(ref)
			if (!fresh && hit && Date.now() - hit.t < ttl) return hit.p
			try {
				const p = await getProfile(ref, current())
				cache.set(ref, { t: Date.now(), p })
				return p
			} catch (e) {
				// A source that hiccups shouldn't strand a conversation in progress: keep the last good profile a while.
				if (!fresh && hit && Date.now() - hit.t < ttl * 30) return hit.p
				throw e
			}
		},
		forget: (ref) => cache.delete(ref),
	}
}
