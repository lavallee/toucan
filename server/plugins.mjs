// Plugins: programs on PATH that extend toucan, found and run in one way whatever they are for.
//
// A plugin is an executable named `toucan-<kind>-<name>`. Each *kind* is an entry in KINDS below: the prefix its
// programs carry, and the verbs they answer. A plugin answers a verb with JSON on stdout and exit 0; on failure it exits
// non-zero and says why on stderr, as one JSON object {"error": CODE, "message": TEXT} or as plain text. Any plugin may
// also answer `describe` with {"name", "description", "version"?}.
//
//   profiles   toucan-profiles-NAME   named agents a canvas can work with    (server/profiles.mjs)
//   source     toucan-source-NAME     plans a canvas can show and write to   (server/sources.mjs)
//
// A new kind is an entry here and the code that calls it: finding, trusting, running and listing come with it.
// (Extension commands, `toucan-NAME`, are the older, simpler sort: the CLI runs them as the person, with the terminal,
// so they follow no protocol and need no trust rule. `scanCommands` lists them for `toucan plugins`.)
//
// The server runs a plugin outside any sandbox, so it only looks where an agent can't put one: PATH folders given as
// absolute paths, outside toucan's own folder and its data (where agents write), not in or under any node_modules (where
// installing a package puts programs, and npm puts node_modules/.bin on PATH), that belong to this user or root and that
// nobody else can write to, under folders of which the same is true all the way up (a sticky folder like /tmp may be
// open to all: nobody can replace another's folder in it); and a program that, once links are followed, is a file under
// the same rule. One found but refused is remembered with the reason, since that is what people get stuck on:
// `toucan plugins`.
//
// A plugin runs in a process group of its own, so that when it takes too long everything it started ends with it.

import { spawn } from 'node:child_process'
import { accessSync, constants, existsSync, readdirSync, realpathSync, statSync } from 'node:fs'
import { delimiter, dirname, isAbsolute, join, resolve, sep } from 'node:path'

export const KINDS = {
	profiles: { prefix: 'toucan-profiles-', title: 'Agent profiles', about: 'named agents a canvas can work with', verbs: ['list', 'get ID'], env: { TOUCAN_PROFILES_PROTOCOL: '1' }, reserved: ['local'] },
	source: { prefix: 'toucan-source-', title: 'Plan sources', about: 'systems of record a canvas can show views of, and write to', verbs: ['list', 'read -- REF', 'changes --after CURSOR -- REF', 'write -- REF'], env: { TOUCAN_SOURCE_PROTOCOL: '1' }, reserved: ['file'] },
}
export const ERROR_CODES = ['not_found', 'invalid', 'conflict', 'forbidden', 'unavailable']
const ID = /^[a-z0-9][a-z0-9_-]{0,63}$/i
const EXT = /\.(m?js|py|sh|exe|cmd)$/i
// Who owns a folder means something only where there are uids.
const UID = process.platform !== 'win32' && typeof process.getuid === 'function' ? process.getuid() : null

/** A plugin failed: `code` is one of ERROR_CODES, `why` the reason on its own, `message` the reason with what was asked. */
export class PluginError extends Error {
	constructor(code, why, what = '') {
		super(what ? `${what}: ${why}` : why)
		this.code = code
		this.why = why
	}
}

/**
 * Why a folder (a real path) can't hold a plugin, in words that follow "its folder" or "whose folder", or null. Whoever
 * can write to a folder above it can swap what is below, so every folder up to the root is asked the same questions.
 */
function distrust(real) {
	const parts = real.split(sep)
	const at = parts.indexOf('node_modules')
	if (at >= 0) return `is ${at === parts.length - 1 ? '' : 'inside '}a node_modules folder (${parts.slice(0, at + 1).join(sep)}), where installing a package puts programs (move the plugin to a folder of your own, such as ~/.local/bin)`
	if (UID === null) return null
	const own = statSync(real)
	if (own.uid !== UID && own.uid !== 0) return `belongs to another user, uid ${own.uid} (chown it, or move the plugin to a folder of your own)`
	if (own.mode & 0o022) return `can be written to by other users (chmod go-w ${real})`
	for (let last = real, dir = dirname(real); dir !== last; last = dir, dir = dirname(dir)) {
		const st = statSync(dir)
		if (st.uid !== UID && st.uid !== 0) return `is inside ${dir}, which belongs to another user, uid ${st.uid} (move the plugin to a folder of your own)`
		// A sticky folder (/tmp) lets anyone add to it and nobody replace what is another's, and what is below it was just
		// found to be ours or root's.
		if (st.mode & 0o022 && !(st.mode & 0o1000)) return `is inside ${dir}, which other users can write to (chmod go-w ${dir})`
	}
	return null
}

/**
 * Every plugin on PATH, of every kind (or of `kinds`): { found: [{ kind, id, command }], refused: [{ kind, id, path, reason }] }.
 * The first of a name on PATH wins. `exclude` and `data` are folders nothing is trusted inside.
 */
export function scan({ data, path = process.env.PATH ?? '', exclude = [], kinds = Object.keys(KINDS) } = {}) {
	const found = [], refused = []
	const seen = new Map(kinds.flatMap((k) => (KINDS[k].reserved ?? []).map((id) => [`${k}/${id}`, null])))
	const fenced = [data, ...exclude].filter(Boolean).map((d) => (existsSync(d) ? realpathSync(d) : resolve(d)))
	const inside = (p) => fenced.some((f) => p === f || p.startsWith(f + sep))
	const openToOthers = (p) => (statSync(p).mode & 0o022) !== 0
	const judged = new Map() // folder -> why not, or null: many plugins share a folder
	const whyNotIn = (real) => (judged.has(real) ? judged : judged.set(real, distrust(real))).get(real)
	const kindOf = (file) => kinds.find((k) => file.startsWith(KINDS[k].prefix))
	for (const dir of path.split(delimiter).filter(Boolean)) {
		let names
		try {
			names = readdirSync(dir).filter(kindOf)
		} catch {
			continue
		}
		if (!names.length) continue
		// Why nothing in this folder can be trusted, if so.
		let folder = null, home = null
		if (!isAbsolute(dir)) folder = 'its folder is on PATH as a relative path, which means a different folder in every directory'
		else {
			try {
				home = realpathSync(dir)
				if (inside(home)) folder = `its folder is inside toucan's own folder or its data, where agents can write`
				else if (openToOthers(home)) folder = `its folder can be written to by other users (chmod go-w ${dir})`
				else if (whyNotIn(home)) folder = `its folder ${whyNotIn(home)}`
			} catch (e) {
				folder = `its folder can't be read: ${e.code ?? e.message}`
			}
		}
		for (const file of names.sort()) {
			const kind = kindOf(file)
			const id = file.slice(KINDS[kind].prefix.length).replace(EXT, '')
			const full = join(dir, file)
			const refuse = (reason) => refused.push({ kind, id, path: full, reason })
			if (!ID.test(id)) {
				refuse(`"${id}" isn't a name: letters, digits, - and _`)
				continue
			}
			const key = `${kind}/${id}`
			if (seen.has(key)) {
				refuse(seen.get(key) ? `${seen.get(key)} comes first on PATH` : `"${id}" is the name of toucan's built-in one`)
				continue
			}
			if (folder) {
				refuse(folder)
				continue
			}
			try {
				accessSync(full, constants.X_OK)
			} catch {
				refuse(`it isn't executable (chmod +x ${full})`)
				continue
			}
			try {
				const target = realpathSync(full)
				const st = statSync(target)
				// Asked only of a program that is a link to elsewhere: its own folder has just been answered for.
				const elsewhere = dirname(target) === home ? null : whyNotIn(dirname(target))
				if (!st.isFile()) refuse('it isn\'t a file')
				else if (inside(target)) refuse(`it links to ${target}, inside toucan's own folder or its data, where agents can write`)
				else if (openToOthers(target)) refuse(`it can be written to by other users (chmod go-w ${target})`)
				else if (UID !== null && st.uid !== UID && st.uid !== 0) refuse(`it belongs to another user, uid ${st.uid} (chown it, or put a copy of your own in its place)`)
				else if (elsewhere) refuse(`it links to ${target}, whose folder ${elsewhere}`)
				else {
					seen.set(key, full)
					found.push({ kind, id, command: full })
				}
			} catch (e) {
				refuse(`it can't be read: ${e.code ?? e.message}`)
			}
		}
	}
	return { found, refused }
}

// A group of its own is a POSIX thing; elsewhere a plugin is killed alone.
const GROUPS = process.platform !== 'win32'
const running = new Set()
function killGroup(child) {
	try {
		if (GROUPS && child.pid) process.kill(-child.pid, 'SIGKILL')
		else child.kill('SIGKILL')
	} catch {
		// Already gone.
	}
}
// A plugin in its own group no longer hears the terminal's Ctrl-C, so the ones still running end with the server.
process.on('exit', () => running.forEach(killGroup))

/**
 * Runs a plugin: arguments as an array (never through a shell), `input` on stdin, a time limit, and its answer parsed.
 * Rejects with a PluginError carrying the code it gave, or `unavailable` (it couldn't run, took too long, or failed
 * without saying how) or `invalid` (it answered with something that isn't JSON).
 *
 * It runs in a process group of its own. One that takes too long or says too much is killed with everything it started:
 * a wrapper script's real work is a child of the script, and killing the script alone would leave that running.
 */
export function ask(command, args, { input, timeout = 15000, env = {}, maxBuffer = 32 << 20 } = {}) {
	return new Promise((resolve, reject) => {
		const what = `${command.split(/[\\/]/).pop()} ${args.join(' ')}`.trim()
		let child
		try {
			child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, ...env }, detached: GROUPS, windowsHide: true })
		} catch (e) {
			return reject(new PluginError('unavailable', e.message, what))
		}
		running.add(child)
		let out = '', err = '', size = 0, done = false
		const finish = (f) => (v) => {
			if (done) return
			done = true
			clearTimeout(timer)
			f(v)
		}
		const ok = finish(resolve), fail = finish(reject)
		// Given up on: the whole group is killed and nothing of it is waited for. Something that left the group and still
		// holds the pipes would otherwise keep them, and so the server, open.
		const stop = () => {
			killGroup(child)
			running.delete(child)
			for (const s of [child.stdin, child.stdout, child.stderr]) s?.destroy()
			child.unref()
		}
		const timer = setTimeout(() => {
			stop()
			fail(new PluginError('unavailable', 'took too long', what))
		}, timeout)
		child.stdout.on('data', (d) => {
			if (done) return
			if ((size += d.length) > maxBuffer) (stop(), fail(new PluginError('invalid', `answered with more than ${maxBuffer >> 20} MB`, what)))
			else out += d
		})
		child.stderr.on('data', (d) => (err = (err + d).slice(-8192)))
		child.on('error', (e) => (running.delete(child), fail(new PluginError('unavailable', e.message, what))))
		child.stdin.on('error', () => {}) // it may not read what it's given
		child.on('close', (code) => {
			running.delete(child)
			if (code !== 0) {
				const lines = err.trim().split('\n').filter(Boolean)
				let said = null
				try {
					said = JSON.parse(lines.at(-1) ?? '')
				} catch {}
				const structured = said && typeof said === 'object' && ERROR_CODES.includes(said.error)
				return fail(new PluginError(structured ? said.error : 'unavailable', String((structured ? said.message : lines[0]) || `failed (exit ${code})`).slice(0, 500), structured ? '' : what))
			}
			try {
				ok(JSON.parse(out))
			} catch {
				fail(new PluginError('invalid', "didn't answer with JSON", what))
			}
		})
		child.stdin.end(input ?? '')
	})
}

/**
 * The plugins on this machine, looked for again at most every `ttl` ms (so one put on PATH is found without a restart,
 * and a poll every few seconds doesn't read PATH each time).
 */
export function createPlugins({ data, exclude = [], path, ttl = 3000 } = {}) {
	let cache = null, at = 0
	const described = new Map() // command -> { stamp, said }: what it said about itself (or null), and of which file
	// A plugin replaced by another is asked again: the file's time and size tell them apart.
	const stampOf = (command) => {
		try {
			const st = statSync(command)
			return `${st.mtimeMs}:${st.size}:${st.ino}`
		} catch {
			return ''
		}
	}
	const all = ({ fresh = false } = {}) => {
		if (fresh || !cache || Date.now() - at > ttl) (cache = scan({ data, exclude, ...(path !== undefined && { path }) })), (at = Date.now())
		return cache
	}
	const of = (kind, opts) => all(opts).found.filter((p) => p.kind === kind)
	const get = (kind, id) => of(kind).find((p) => p.id === id) ?? of(kind, { fresh: true }).find((p) => p.id === id) ?? null
	/** Why a plugin someone named isn't there: refused, with the reason, or simply not on PATH. */
	const whyNot = (kind, id) => {
		const r = all().refused.find((p) => p.kind === kind && p.id === id)
		return r ? `${r.path} was found but not trusted: ${r.reason}` : `toucan looks for ${KINDS[kind].prefix}${id} on PATH`
	}
	const call = (plugin, args, opts = {}) => ask(plugin.command, args, { ...opts, env: { ...KINDS[plugin.kind].env, ...opts.env } })
	/** What a plugin says about itself. One that doesn't answer `describe` is none the worse for it. */
	async function describe(plugin) {
		const stamp = stampOf(plugin.command)
		if (described.get(plugin.command)?.stamp !== stamp) {
			const d = await call(plugin, ['describe'], { timeout: 4000 }).catch(() => null)
			const str = (v, max) => (typeof v === 'string' && v ? v.slice(0, max) : undefined)
			described.set(plugin.command, { stamp, said: d && typeof d === 'object' ? { ...(str(d.name, 80) && { name: str(d.name, 80) }), ...(str(d.description, 400) && { description: str(d.description, 400) }), ...(str(d.version, 40) && { version: str(d.version, 40) }) } : null })
		}
		return described.get(plugin.command).said
	}
	/** Everything, for `toucan plugins`: each kind with what it is, the plugins found, and the ones refused with why. */
	async function list() {
		const { found, refused } = all({ fresh: true })
		const rows = await Promise.all(found.map(async (p) => ({ ...p, ...(await describe(p)) })))
		return {
			kinds: Object.entries(KINDS).map(([kind, k]) => ({ kind, title: k.title, about: k.about, prefix: k.prefix, verbs: [...k.verbs, 'describe'], plugins: rows.filter((p) => p.kind === kind).map(({ kind: _, id, command, name, ...rest }) => ({ name: id, path: command, ...(name && { title: name }), ...rest })), refused: refused.filter((p) => p.kind === kind).map(({ kind: _, id, ...rest }) => ({ name: id, ...rest })) })),
		}
	}
	return { all, of, get, whyNot, call, describe, list }
}

/** Extension commands on a PATH: `toucan-NAME` programs that aren't a plugin of some kind. The CLI runs these, as the person. */
export function scanCommands(path = process.env.PATH ?? '') {
	const out = [], seen = new Set()
	const prefixes = Object.values(KINDS).map((k) => k.prefix)
	for (const dir of path.split(delimiter).filter((d) => d && isAbsolute(d))) {
		let names
		try {
			names = readdirSync(dir)
		} catch {
			continue
		}
		for (const file of names.sort()) {
			if (!file.startsWith('toucan-') || prefixes.some((p) => file.startsWith(p))) continue
			const name = file.slice('toucan-'.length).replace(EXT, '')
			if (!/^[a-z0-9][a-z0-9-]*$/i.test(name) || seen.has(name)) continue
			try {
				accessSync(join(dir, file), constants.X_OK)
				if (!statSync(join(dir, file)).isFile()) continue
			} catch {
				continue
			}
			seen.add(name)
			out.push({ name, path: join(dir, file) })
		}
	}
	return out
}
