// Where toucan keeps things on this machine. The CLI and the server share these.
//
//   ~/.config/toucan/server.json     token, address of the running server, sticky `toucan start` options
//   ~/.config/toucan/agents.json     which agents toucan registered its MCP server with
//   ~/.config/toucan/projects.json   which canvas belongs to which project directory (`toucan init`)
//   <data home>/canvases/            canvases: documents that outlive any install of the app
//   <data home>/server.log           log of a server started by `toucan start`

import { randomBytes } from 'node:crypto'
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

export const CONFIG_DIR = join(homedir(), '.config/toucan')
export const CONFIG = join(CONFIG_DIR, 'server.json')
export const PROJECTS = join(CONFIG_DIR, 'projects.json')
export const AGENTS = join(CONFIG_DIR, 'agents.json')

/** The platform's place for a user's application data. */
export function dataHome({ platform = process.platform, env = process.env, home = homedir() } = {}) {
	if (platform === 'darwin') return join(home, 'Library/Application Support/toucan')
	if (platform === 'win32') return join(env.LOCALAPPDATA || join(home, 'AppData/Local'), 'toucan')
	return join(env.XDG_DATA_HOME || join(home, '.local/share'), 'toucan')
}

export const readJson = (file, fallback = {}) => {
	try {
		return JSON.parse(readFileSync(file, 'utf8'))
	} catch {
		return fallback
	}
}

/** Replace a file in one step, so nothing ever reads half of it. */
export function writeAtomic(file, text, mode = 0o600) {
	mkdirSync(dirname(file), { recursive: true })
	const tmp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`
	writeFileSync(tmp, text, { mode, flag: 'wx' })
	renameSync(tmp, file)
}

export const writeConfig = (cfg) => writeAtomic(CONFIG, JSON.stringify(cfg, null, 2) + '\n')

/**
 * The server's token, made if there isn't one. Several servers can start at once, and they must all end up with
 * the same one, so making it happens under a lock.
 */
export function ensureToken() {
	const existing = readJson(CONFIG).token
	if (existing) return existing
	mkdirSync(dirname(CONFIG), { recursive: true })
	const lock = `${CONFIG}.lock`
	for (let i = 0; i < 100; i++) {
		try {
			closeSync(openSync(lock, 'wx', 0o600))
		} catch (e) {
			if (e.code !== 'EEXIST') throw e
			// Whoever held it died: a lock lives for milliseconds.
			if (Date.now() - statSync(lock, { throwIfNoEntry: false })?.mtimeMs > 5000) rmSync(lock, { force: true })
			Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50)
			continue
		}
		try {
			const cfg = readJson(CONFIG)
			if (cfg.token) return cfg.token
			const token = randomBytes(24).toString('base64url')
			writeConfig({ ...cfg, token })
			return token
		} finally {
			rmSync(lock, { force: true })
		}
	}
	throw new Error(`couldn't make a token: ${lock} stays locked`)
}

/**
 * Where a server keeps canvases when it isn't told: --data, then TOUCAN_DATA. A checkout that already holds canvases
 * keeps using them, since they were made before the data home existed and moving a person's documents isn't something
 * to do silently. Everyone else gets the data home. (`toucan start --data` passes --data to the server it starts.)
 */
export function resolveData({ flag, root, env = process.env, ...platform } = {}) {
	if (typeof flag === 'string') return { dir: resolve(flag), why: '--data' }
	if (env.TOUCAN_DATA) return { dir: resolve(env.TOUCAN_DATA), why: 'TOUCAN_DATA' }
	const legacy = root && join(root, 'canvases')
	if (legacy && existsSync(legacy) && readdirSync(legacy).length) return { dir: legacy, why: 'canvases already in this checkout' }
	return { dir: join(dataHome({ env, ...platform }), 'canvases'), why: 'default' }
}
