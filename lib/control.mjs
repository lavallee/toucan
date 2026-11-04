// Starting, stopping and finding the local toucan server, so nobody has to think about it. A CLI command
// that needs a server starts one in the background, unless this machine's server is run by something else
// (systemd, `npm start`), which should stay in charge of it.

import { spawn } from 'node:child_process'
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CONFIG, dataHome, readJson, writeConfig } from './paths.mjs'

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const VERSION = readJson(join(ROOT, 'package.json')).version
export const LOG = join(dataHome(), 'server.log')
export const DEFAULT_PORT = 8893

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
export const readCfg = () => readJson(CONFIG)

const writeCfg = (patch) => writeConfig({ ...readCfg(), ...patch })

const portFor = (cfg, opts = {}) => opts.port ?? (Number(process.env.TOUCAN_PORT) || cfg.start?.port || cfg.port || DEFAULT_PORT)

/** Where this machine's server should be: TOUCAN_URL, then TOUCAN_PORT, then where it last was. */
export const serverUrl = (cfg = readCfg()) => process.env.TOUCAN_URL || (process.env.TOUCAN_PORT ? `http://127.0.0.1:${process.env.TOUCAN_PORT}` : cfg.url ?? `http://127.0.0.1:${portFor(cfg)}`)

/** Someone runs this machine's server themselves (systemd, `npm start`): its server.json doesn't say toucan started it. */
export const runByHand = (cfg = readCfg()) => !!(cfg.token && cfg.url && cfg.managed !== true)

/**
 * What's at the configured address:
 *   up        a toucan server, with `health` (an older server answers without one)
 *   down      nothing is listening
 *   slow      something is, but it didn't answer in time: a busy server looks like this
 *   foreign   something else is, or a toucan server with another token
 *   blocked   the connection isn't allowed: usually an agent's sandbox
 */
export async function probe(url = serverUrl(), token = process.env.TOUCAN_TOKEN || readCfg().token) {
	try {
		const res = await fetch(`${url}/api/health`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(2000) })
		const body = await res.json().catch(() => null)
		if (res.ok && body?.ok) return { state: 'up', url, health: body }
		if (res.status === 404 && body?.error === 'not found') return { state: 'up', url, health: {} }
		return { state: 'foreign', url, status: res.status }
	} catch (e) {
		const code = e.cause?.code ?? e.name
		if (code === 'ECONNREFUSED') return { state: 'down', url }
		if (code === 'TimeoutError') return { state: 'slow', url }
		if (code === 'EPERM' || code === 'EACCES' || code === 'ENETUNREACH') return { state: 'blocked', url, code }
		return { state: 'foreign', url, code }
	}
}

export const BLOCKED_HELP = "this process isn't allowed to reach the toucan server, because a sandbox blocks local network (Codex's does by default). Use the toucan_* MCP tools instead: they do the same things and run outside the sandbox. If you don't have them, ask the person to run `toucan agents install codex` (or `--mcp` for another agent) and start a new session."

function logFile() {
	mkdirSync(dirname(LOG), { recursive: true, mode: 0o700 })
	if (existsSync(LOG) && statSync(LOG).size > 5e6) renameSync(LOG, `${LOG}.1`)
	return openSync(LOG, 'a', 0o600)
}

const TAKE_OVER = 'To have toucan run it from now on, run `toucan start --take-over`.'

const logTail = () => (existsSync(LOG) ? readFileSync(LOG, 'utf8').trim().split('\n').slice(-6).join('\n') : '')

/**
 * Start a background server. Options given here stick, for later automatic starts and restarts. Headless mode
 * is on unless asked otherwise: it costs nothing until an agent runs code with no tab open, and without it
 * that run could only fail.
 */
export async function start(opts = {}, { takeOver = false } = {}) {
	const cfg = readCfg()
	// One server to a machine: two on one data directory overwrite each other's work. So look first where it last was.
	const current = await probe(cfg.url ? cfg.url : serverUrl(cfg))
	if (current.state === 'blocked') throw new Error(BLOCKED_HELP)
	if (current.state === 'up' || current.state === 'slow') {
		const mine = current.health?.managed
		if (!mine && Object.keys(opts).length) throw new Error(`a server you run yourself is at ${current.url}, so these options can't apply. Stop it the way you started it; ${TAKE_OVER}`)
		if (Object.keys(opts).length) writeCfg({ start: { ...cfg.start, ...opts } })
		return { ...current, state: 'up', health: current.health ?? {}, already: true, ...(Object.keys(opts).length && { pending: true }) }
	}
	if (runByHand(cfg) && !takeOver) throw new Error(`the server at ${current.url} isn't running, and it was started by something else (a service, or \`npm start\`). Start it that way. ${TAKE_OVER}`)
	const merged = { ...cfg.start, ...opts }
	if (Object.keys(opts).length) writeCfg({ start: merged })
	const port = portFor(readCfg(), merged)
	const url = `http://127.0.0.1:${port}`
	const now = await probe(url)
	if (now.state === 'up') return { ...now, already: true }
	if (now.state === 'foreign' || now.state === 'slow') throw new Error(`port ${port} is in use by something else (or a toucan server with a different token). Choose another: toucan start --port N`)
	const args = [join(ROOT, 'server/index.mjs'), '--port', String(port)]
	if (merged.host) args.push('--host', merged.host)
	if (merged.data) args.push('--data', merged.data)
	if (merged.headless !== false) args.push('--headless')
	const log = logFile()
	const child = spawn(process.execPath, args, { cwd: ROOT, detached: true, windowsHide: true, stdio: ['ignore', log, log], env: { ...process.env, TOUCAN_MANAGED: '1' } })
	closeSync(log)
	let exited = false
	child.on('exit', () => (exited = true))
	child.unref()
	for (let i = 0; i < 100; i++) {
		await sleep(150)
		const p = await probe(url)
		if (p.state === 'up' && p.health.pid) return p
		// Lost a race with another command that was starting it too: keep waiting for theirs, but not for long.
		if (exited && i > 20) break
	}
	throw new Error(`the server didn't start. Last lines of ${LOG}:\n${logTail()}`)
}

/** Make sure a server is reachable before a command needs it. Says so on stderr if it had to start one. */
export async function ensure() {
	const cfg = readCfg()
	const p = await probe()
	if (p.state === 'up' || p.state === 'slow') return p
	if (p.state === 'blocked') throw new Error(BLOCKED_HELP)
	if (p.state === 'foreign') throw new Error(`can't talk to the toucan server at ${p.url}: something else is on that port, or its token has changed. \`toucan doctor\` looks into it.`)
	if (process.env.TOUCAN_NO_AUTOSTART || runByHand(cfg)) throw new Error(`the toucan server at ${p.url} isn't running. Start it the way you usually do. ${TAKE_OVER}`)
	const started = await start()
	if (!started.already) console.error(`toucan: started the server at ${started.url} (stop it with \`toucan stop\`)`)
	return started
}

/** Stop a server that `toucan start` started. One run by something else is left alone. */
export async function stop() {
	const p = await probe()
	if (p.state !== 'up') return { stopped: false, why: 'not running' }
	if (!p.health.managed || !p.health.pid) return { stopped: false, why: `this server wasn't started by \`toucan start\`${p.health.pid ? ` (pid ${p.health.pid})` : ''}; stop it the way it was started` }
	const alive = () => {
		try {
			process.kill(p.health.pid, 0)
			return true
		} catch {
			return false
		}
	}
	if (!alive()) return { stopped: true }
	process.kill(p.health.pid, 'SIGTERM')
	// The process, not its answers: a busy server doesn't answer, and it hasn't stopped. It saves on the way out.
	for (let i = 0; i < 50 && alive(); i++) await sleep(150)
	if (!alive()) return { stopped: true }
	process.kill(p.health.pid, 'SIGKILL')
	return { stopped: true, forced: true }
}
