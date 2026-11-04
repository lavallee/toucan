// Connecting toucan to the agents already on this machine. Agents with a shell get the skill, which teaches them
// the CLI. MCP is for agents that can't use the CLI: Claude Desktop has no shell, and Codex's sandbox blocks the
// local network the CLI needs (MCP servers run outside that sandbox). `--mcp` adds it everywhere else.

import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { ROOT, VERSION } from './control.mjs'
import { AGENTS, readJson, writeAtomic } from './paths.mjs'

const MARKER = '.installed-by-toucan'
const BIN = join(ROOT, 'bin/toucan.mjs')

export function onPath(cmd, env = process.env) {
	const names = process.platform === 'win32' ? [`${cmd}.cmd`, `${cmd}.exe`, cmd] : [cmd]
	return (env.PATH ?? '').split(delimiter).some((d) => d && names.some((n) => existsSync(join(d, n)) && statSync(join(d, n)).isFile()))
}

/**
 * How to launch `toucan mcp`. Terminal agents share the person's PATH. GUI apps often don't, so they get absolute
 * paths, which a later change of Node version can break; `toucan agents install` writes them again.
 */
function launch(absolute) {
	if (!absolute && onPath('toucan')) return ['toucan', 'mcp']
	return [process.execPath, realpathSync(BIN), 'mcp']
}

function desktopConfig({ platform = process.platform, env = process.env, home = homedir() } = {}) {
	if (platform === 'darwin') return join(home, 'Library/Application Support/Claude/claude_desktop_config.json')
	if (platform === 'win32') return join(env.APPDATA || join(home, 'AppData/Roaming'), 'Claude/claude_desktop_config.json')
	return null
}

export const harnesses = (opts) => {
	const home = opts?.home ?? homedir()
	const desktop = desktopConfig({ ...opts, home })
	return [
		{ id: 'claude', name: 'Claude Code', bin: 'claude', dir: '.claude', skills: '.claude/skills', add: (c) => ['claude', 'mcp', 'add', '-s', 'user', 'toucan', '--', ...c], rm: ['claude', 'mcp', 'remove', '-s', 'user', 'toucan'] },
		{ id: 'codex', name: 'Codex', bin: 'codex', dir: '.codex', skills: '.agents/skills', mcpByDefault: true, add: (c) => ['codex', 'mcp', 'add', 'toucan', '--', ...c], rm: ['codex', 'mcp', 'remove', 'toucan'] },
		{ id: 'gemini', name: 'Gemini CLI', bin: 'gemini', dir: '.gemini', skills: '.gemini/skills', add: (c) => ['gemini', 'mcp', 'add', '-s', 'user', 'toucan', ...c], rm: ['gemini', 'mcp', 'remove', '-s', 'user', 'toucan'] },
		{ id: 'pi', name: 'pi', bin: 'pi', dir: '.pi', skills: '.pi/agent/skills', add: (c) => ['pi', 'mcp', 'add', 'toucan', '--', ...c], rm: ['pi', 'mcp', 'remove', 'toucan'] },
		{ id: 'cursor', name: 'Cursor', bin: 'cursor', dir: '.cursor', skills: '.cursor/skills', file: join(home, '.cursor/mcp.json'), absolute: true },
		{ id: 'opencode', name: 'opencode', bin: 'opencode', dir: '.config/opencode', skills: '.config/opencode/skills', file: join(home, '.config/opencode/opencode.json'), shape: 'opencode' },
		...(desktop ? [{ id: 'claude-desktop', name: 'Claude Desktop', detect: dirname(desktop), file: desktop, mcpByDefault: true, absolute: true }] : []),
	]
}

const present = (h, home) => (h.bin && onPath(h.bin)) || existsSync(h.detect ?? join(home, h.dir))

function skillState(h, home) {
	if (!h.skills) return null
	const dir = join(home, h.skills, 'toucan')
	if (!existsSync(dir)) return 'none'
	const mark = join(dir, MARKER)
	if (!existsSync(mark)) return 'foreign'
	return readFileSync(mark, 'utf8').trim() === VERSION ? 'current' : 'outdated'
}

const entryOf = (h, j) => (h.shape === 'opencode' ? j.mcp?.toucan : j.mcpServers?.toucan)

/** An entry named toucan is ours if it launches `toucan mcp`; someone may have another server of that name. */
function entryIsOurs(entry) {
	if (!entry) return false
	const argv = Array.isArray(entry.command) ? entry.command : [entry.command, ...(entry.args ?? [])]
	return argv.at(-1) === 'mcp' && argv.slice(0, -1).some((a) => /(^|[\\/])toucan(\.mjs)?$/.test(String(a)))
}

function readMcpFile(h) {
	if (!existsSync(h.file)) return null
	try {
		return JSON.parse(readFileSync(h.file, 'utf8'))
	} catch {
		return undefined
	}
}

function mcpFileHas(h) {
	const j = readMcpFile(h)
	return !!j && entryIsOurs(entryOf(h, j))
}

/** Add or remove the `toucan` entry in a harness's JSON config, keeping everything else in it. */
function editMcpFile(h, entry) {
	const j = readMcpFile(h)
	if (j === undefined) throw new Error(`${h.file} isn't plain JSON (comments?), so toucan left it alone. Add this by hand: ${JSON.stringify(entry ?? {})}`)
	// A config kept in a dotfiles repository is often a symlink: write what it points at.
	const file = existsSync(h.file) ? realpathSync(h.file) : h.file
	if (j && !existsSync(`${h.file}.before-toucan`)) cpSync(file, `${h.file}.before-toucan`, { dereference: true })
	const next = j ?? {}
	const key = h.shape === 'opencode' ? 'mcp' : 'mcpServers'
	if (entry) next[key] = { ...next[key], toucan: entry }
	else if (next[key]) delete next[key].toucan
	writeAtomic(file, JSON.stringify(next, null, 2) + '\n', existsSync(file) ? statSync(file).mode & 0o777 : 0o600)
}

function runCli(argv) {
	const r = spawnSync(argv[0], argv.slice(1), { encoding: 'utf8', timeout: 30000, shell: process.platform === 'win32' })
	return { ok: r.status === 0, detail: (r.stderr || r.stdout || r.error?.message || '').trim().split('\n').slice(-1)[0] }
}

const registered = () => readJson(AGENTS, { mcp: [] }).mcp ?? []
const remember = (id, on) => writeAtomic(AGENTS, JSON.stringify({ mcp: on ? [...new Set([...registered(), id])] : registered().filter((x) => x !== id) }, null, 2) + '\n')

function addMcp(h, force) {
	const [command, ...args] = launch(h.absolute)
	if (h.file) {
		const j = readMcpFile(h)
		const existing = j && entryOf(h, j)
		if (existing && !entryIsOurs(existing) && !force) throw new Error(`${h.file} already has a server named toucan that isn't this one, so it was left alone (--force replaces it)`)
		editMcpFile(h, h.shape === 'opencode' ? { type: 'local', command: [command, ...args], enabled: true } : { command, args })
		return `MCP in ${h.file}`
	}
	// So a second install replaces the first rather than failing. Only ours: its name may be someone else's.
	if (registered().includes(h.id)) runCli(h.rm)
	const r = runCli(h.add([command, ...args]))
	if (!r.ok) throw new Error(`\`${h.add([command, ...args]).join(' ')}\` failed: ${r.detail}`)
	remember(h.id, true)
	return `MCP via \`${h.bin} mcp add\``
}

function removeMcp(h) {
	if (h.file) return mcpFileHas(h) ? (editMcpFile(h, null), true) : false
	if (!registered().includes(h.id) || !onPath(h.bin)) return false
	const done = runCli(h.rm).ok
	if (done) remember(h.id, false)
	return done
}

function pick(ids, all) {
	const unknown = ids.filter((id) => !all.some((h) => h.id === id))
	if (unknown.length) throw new Error(`unknown agent: ${unknown.join(', ')}. Known: ${all.map((h) => h.id).join(', ')}`)
	return all.filter((h) => ids.includes(h.id))
}

/** What's on this machine and how it's connected. */
export function status({ home = homedir() } = {}) {
	return harnesses({ home }).map((h) => ({
		id: h.id,
		name: h.name,
		present: !!present(h, home),
		skill: skillState(h, home),
		...(h.file && { mcp: mcpFileHas(h) }),
	}))
}

/** Connect the named agents, or every one found here. One failure doesn't stop the others. */
export function install({ ids = [], mcp = false, force = false, skillOnly = false, home = homedir() } = {}) {
	const all = harnesses({ home })
	const targets = ids.length ? pick(ids, all) : all.filter((h) => present(h, home))
	return targets.map((h) => {
		const did = [], problems = []
		if (h.skills) {
			const dir = join(home, h.skills, 'toucan')
			if (skillState(h, home) === 'foreign' && !force) problems.push(`${dir} wasn't installed by toucan, so it was left alone (--force replaces it)`)
			else {
				rmSync(dir, { recursive: true, force: true })
				mkdirSync(dirname(dir), { recursive: true })
				cpSync(join(ROOT, 'skills/toucan'), dir, { recursive: true })
				writeFileSync(join(dir, MARKER), VERSION + '\n')
				did.push(`skill in ${dir}`)
			}
		}
		if (!skillOnly && (mcp || h.mcpByDefault)) {
			try {
				did.push(addMcp(h, force))
			} catch (e) {
				problems.push(e.message)
			}
		}
		return { id: h.id, name: h.name, did, problems }
	})
}

/** After an update: bring installed copies of the skill up to date, and add nothing new. */
export function refresh({ home = homedir() } = {}) {
	const ids = harnesses({ home }).filter((h) => skillState(h, home) === 'outdated').map((h) => h.id)
	return ids.length ? install({ ids, home, skillOnly: true }) : []
}

/** Disconnect the named agents, or all of them. Only what toucan installed is removed. */
export function remove({ ids = [], home = homedir() } = {}) {
	const all = harnesses({ home })
	return (ids.length ? pick(ids, all) : all).map((h) => {
		const did = []
		const state = skillState(h, home)
		if (state === 'current' || state === 'outdated') {
			rmSync(join(home, h.skills, 'toucan'), { recursive: true, force: true })
			did.push('skill')
		}
		try {
			if (removeMcp(h)) did.push('MCP')
		} catch (e) {
			did.push(`MCP not removed: ${e.message}`)
		}
		return { id: h.id, name: h.name, did }
	}).filter((r) => r.did.length)
}
