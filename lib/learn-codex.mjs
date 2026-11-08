// Past work from Codex's own session logs, for the work log: so toucan can suggest routines from what agents already did on
// canvases before the work log existed, not only from now on. `toucan routine learn --codex [DIR]` reads them; nothing in
// them is changed.
//
// A session is JSON lines. A shell command the agent ran is a `function_call` (or `custom_tool_call`) whose arguments hold
// the command, and its output is a later line with the same call id. What's kept: each successful `toucan … exec`, with its
// canvas, label and code (inline with -e, or the file it ran, if that file is still there).

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'

/** Every .jsonl under a folder, newest last. */
function sessions(dir) {
	const out = []
	const walk = (d) => {
		let list
		try {
			list = readdirSync(d, { withFileTypes: true })
		} catch {
			return
		}
		for (const e of list) e.isDirectory() ? walk(join(d, e.name)) : e.name.endsWith('.jsonl') && out.push(join(d, e.name))
	}
	walk(dir)
	return out.sort()
}

/** A shell command split into words, honouring quotes. Enough for the commands agents write; a heredoc ends it. */
export function words(cmd) {
	const out = []
	let cur = '', quote = null, any = false
	for (let i = 0; i < cmd.length; i++) {
		const c = cmd[i]
		if (quote) {
			if (c === quote) quote = null
			else if (c === '\\' && quote === '"' && i + 1 < cmd.length) cur += cmd[++i]
			else cur += c
		} else if (c === "'" || c === '"') (quote = c), (any = true)
		else if (/\s/.test(c)) {
			if (cur || any) out.push(cur)
			cur = ''
			any = false
		} else if (c === '\\' && i + 1 < cmd.length) cur += cmd[++i]
		else if ((c === '|' || c === ';' || c === '&') && !cur) break
		else if (c === '<' && cmd[i + 1] === '<') break
		else cur += c
	}
	if (cur || any) out.push(cur)
	return out
}

/** The toucan exec in one shell command, if there is one: { canvas, label, code } or { canvas, label, file }. */
export function toucanExec(cmd, cwd = '') {
	const shell = cmd.match(/^(?:\/\S*\/)?(?:ba|z)?sh\s+-l?c\s+([\s\S]*)$/)
	const line = shell ? words(shell[1])[0] ?? '' : cmd
	const w = words(line.replace(/^.*?((?:node\s+\S*bin\/toucan\.mjs|\btoucan)\s)/, '$1'))
	const at = w.findIndex((x) => /(^|\/)toucan(\.mjs)?$/.test(x))
	if (at < 0) return null
	const rest = w.slice(at + 1)
	const flag = (n) => {
		const i = rest.indexOf(`--${n}`)
		return i >= 0 ? rest[i + 1] : undefined
	}
	const ex = rest.indexOf('exec')
	if (ex < 0) return null
	const canvas = flag('canvas')
	if (!canvas) return null
	const label = flag('label')
	const e = rest.indexOf('-e', ex)
	if (e >= 0 && rest[e + 1]) return { canvas, label, code: rest[e + 1] }
	const file = rest[ex + 1]
	if (!file || file.startsWith('-')) return null
	return { canvas, label, file: isAbsolute(file) ? file : resolve(cwd || '.', file) }
}

const failed = (out = '') => /"exit_code"\s*:\s*[1-9]|^toucan: |Error:|exited with code [1-9]|exit code [1-9]/m.test(out)

/**
 * The shell commands in one tool call. Usually its arguments are JSON ({cmd} or {command: [...]}); in code mode they're a
 * script calling exec({cmd: "…"}) or with a template string, so the commands are picked out of it.
 */
export function commandsIn(input) {
	try {
		const a = JSON.parse(input)
		const cmd = Array.isArray(a.command) ? a.command.join(' ') : a.cmd ?? a.command
		return typeof cmd === 'string' ? [{ cmd, workdir: a.workdir }] : []
	} catch {}
	const out = []
	const workdir = String(input).match(/workdir\s*:\s*"((?:[^"\\]|\\.)*)"/)?.[1]
	for (const m of String(input).matchAll(/\bcmd\s*:\s*("(?:[^"\\]|\\.)*")/g)) {
		try {
			out.push({ cmd: JSON.parse(m[1]), workdir })
		} catch {}
	}
	for (const m of String(input).matchAll(/\bcmd\s*:\s*`((?:[^`\\]|\\.)*)`/g)) out.push({ cmd: m[1].replace(/\\`/g, '`'), workdir })
	return out
}

/** The toucan execs in Codex's sessions, oldest first, as work-log entries. */
export function readCodex(dir = join(process.env.CODEX_HOME ?? join(homedir(), '.codex'), 'sessions'), { since = 0 } = {}) {
	if (!existsSync(dir)) throw new Error(`no Codex sessions in ${dir}`)
	const seen = new Set()
	const entries = []
	for (const f of sessions(dir)) {
		if (since && statSync(f).mtimeMs < since) continue
		let text
		try {
			text = readFileSync(f, 'utf8')
		} catch {
			continue
		}
		if (!/toucan/.test(text)) continue
		let cwd = ''
		const calls = [], outputs = new Map()
		for (const line of text.split('\n')) {
			let o
			try {
				o = JSON.parse(line)
			} catch {
				continue
			}
			const p = o.payload ?? {}
			if (o.type === 'session_meta' || p.cwd) cwd = p.cwd ?? cwd
			if (p.type === 'function_call' || p.type === 'custom_tool_call') calls.push({ t: o.timestamp, id: p.call_id, input: p.arguments ?? p.input ?? '' })
			else if (p.type === 'function_call_output' || p.type === 'custom_tool_call_output') {
				const out = Array.isArray(p.output) ? p.output.map((x) => x?.text ?? '').join('') : typeof p.output === 'string' ? p.output : JSON.stringify(p.output ?? '')
				outputs.set(p.call_id, out)
			}
		}
		for (const c of calls) {
			// A forked thread replays its parent's calls; each call counts once.
			if (!c.id || seen.has(c.id)) continue
			for (const { cmd, workdir } of commandsIn(c.input)) {
			if (!/toucan/.test(cmd)) continue
			const run = toucanExec(cmd, workdir ?? cwd)
			if (!run || failed(outputs.get(c.id))) continue
			let code = run.code
			if (!code && run.file && existsSync(run.file)) code = readFileSync(run.file, 'utf8')
			if (!code) continue
			seen.add(c.id)
			entries.push({ id: `codex:${c.id}:${entries.length}`, t: c.t ?? new Date(0).toISOString(), canvas: run.canvas, agent: 'Codex', kind: 'exec', label: run.label, code, ok: true, source: 'codex' })
			}
		}
	}
	return entries.sort((a, b) => Date.parse(a.t) - Date.parse(b.t))
}
