// `toucan mcp`: the CLI as a Model Context Protocol server on stdio, for agents that can't run the CLI themselves.
// Each tool runs bin/toucan.mjs, so there's still one path to a canvas and this file adds no behaviour of its own.
//
// It speaks both eras of the protocol: per-request metadata and server/discover (2026-07-28), and the initialize
// handshake of earlier revisions, which a client chooses by how it opens.

import { execFile } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { ROOT, VERSION } from './control.mjs'

const MODERN = ['2026-07-28']
const LEGACY = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05']
const SERVER = { name: 'toucan', title: 'toucan', version: VERSION }
const INSTRUCTIONS = `toucan is a canvas in a browser that a person edits by hand while you edit it through these tools. A person may be looking at it right now: inspect before you change, keep edits small and keyed, and never wipe their work. Call toucan_guide before your first edit. Start with toucan_project_canvas (a canvas for the project you're working in), then toucan_open so the person can watch. With no canvas argument, tools use the project's canvas.`

// This server usually runs outside the agent's sandbox, so its tools mustn't hand over what the sandbox withholds:
// other programs, or files by path. So toucan_cli runs these commands only, each taking anything from a file through
// stdin, and nothing that manages this install. What needs a file has its own tool here, which takes text.
const CLI_ALLOWED = ['canvases', 'summary', 'script', 'new', 'meta', 'notes', 'selection', 'proposals', 'log', 'versions', 'routine', 'threads', 'files', 'templates', 'status', 'plan', 'sources', 'plugins']
const NAME = /^[a-z0-9][a-z0-9-_]{0,63}$/i

/** The arguments for toucan_cli, or an error saying why not. */
function checkCli(args) {
	if (!Array.isArray(args) || args.some((a) => typeof a !== 'string')) throw new Error('args must be a list of strings')
	let rest = args
	if (rest[0] === '--canvas') {
		checkCanvas(rest[1])
		rest = rest.slice(2)
	}
	// (`plan view … --from DATE` is a day on a gantt's axis, not a file.)
	const fileFlags = rest[0] === 'plan' ? /^--(canvas|server|copy)\b/ : /^--(canvas|server|from|plan)\b/
	if (rest.includes('--canvas') || rest.includes('--server') || rest.some((a) => fileFlags.test(a))) throw new Error('toucan_cli takes --canvas first and only once, talks to the local server only, and new --from, new --plan and plan bind --copy are not available here')
	if (!CLI_ALLOWED.includes(rest[0])) throw new Error(`toucan_cli can't run "${rest[0]}". Allowed: ${CLI_ALLOWED.join(', ')}`)
	const [cmd, sub, , file] = rest
	if (cmd === 'plan' && sub === 'view' && rest[2] === 'put' && file !== '-') throw new Error('plan view put here takes its spec through stdin: use - for the file')
	if (cmd === 'plan' && sub === 'bind' && rest[2] === 'file' && !/^(files|project(-\d+)?)\//.test(file ?? '')) throw new Error('plan bind file here takes a reference, files/PATH or project/PATH, not a path on disk')
	if (((cmd === 'script' && sub === 'put') || (cmd === 'routine' && sub === 'save')) && file !== '-') throw new Error(`${cmd} ${sub} here takes its code through stdin: use - for the file`)
	return args
}

function checkCanvas(name) {
	if (typeof name !== 'string' || !NAME.test(name)) throw new Error(`"${name}" isn't a canvas name`)
	return name
}

const canvas = { canvas: { type: 'string', description: "Canvas name. Leave out to use the project's canvas." } }
const object = (properties, required) => ({ type: 'object', properties, ...(required && { required }) })

const TOOLS = [
	{
		name: 'toucan_guide',
		description: 'The full guide to working on a canvas: helpers, graph format, proposals, notes, threads, templates. Read once before your first edit.',
		inputSchema: object({}),
		readOnly: true,
		argv: () => ['guide'],
	},
	{
		name: 'toucan_project_canvas',
		description: "Find or make the canvas for a project. Safe to call again: it returns the same canvas. Later calls from this project use it by default.",
		inputSchema: object({
			project_dir: { type: 'string', description: 'The project directory. Leave out to use the directory this server was started in.' },
			name: { type: 'string', description: "Canvas name. Default: from the project's directory name." },
			title: { type: 'string' },
			template: { type: 'string', description: 'A template ID from toucan_templates to start from.' },
			engine: { type: 'string', enum: ['tldraw', 'excalidraw'] },
		}),
		argv: (a) => ['init', ...(a.name ? [checkCanvas(a.name)] : []), ...opt('--title', a.title), ...opt('--template', a.template), ...opt('--engine', a.engine)],
		cwd: (a) => a.project_dir,
	},
	{
		name: 'toucan_open',
		description: "Open a canvas in the person's browser so they can watch and edit. Returns its link.",
		inputSchema: object({ ...canvas }),
		argv: (a) => ['open', ...(a.canvas ? [checkCanvas(a.canvas)] : [])],
	},
	{
		name: 'toucan_canvases',
		description: 'List every canvas: title, description, shape count, open tabs.',
		inputSchema: object({}),
		readOnly: true,
		argv: () => ['canvases'],
	},
	{
		name: 'toucan_summary',
		description: 'JSON of the shapes on a canvas: key, type, bounds, text, arrow ends, plus what people have selected. Look before you change.',
		inputSchema: object({ ...canvas, within: { type: 'string', description: 'Only what is inside this frame key.' } }),
		readOnly: true,
		argv: (a) => [...on(a), 'summary', ...opt('--within', a.within)],
	},
	{
		name: 'toucan_screenshot',
		description: 'A picture of the canvas.',
		inputSchema: object({ ...canvas, keys: { type: 'array', items: { type: 'string' }, description: 'Only these shapes.' } }),
		readOnly: true,
		image: true,
	},
	{
		name: 'toucan_show',
		description: 'Open something for the person to read beside the canvas, in its References panel: a file you wrote for the canvas (files/NAME), one in the project (project/PATH), a path inside either, or a web page (https://…). Use it after writing research or notes, or to show a source.',
		inputSchema: object({ ...canvas, ref: { type: 'string', description: 'files/…, project/…, a path, or https://…' } }, ['ref']),
		argv: (a) => [...on(a), 'show', a.ref],
	},
	{
		name: 'toucan_draw',
		description: 'Lay out a diagram described as data beside what is on the canvas. Prefer this to placing boxes by hand. The usual form is {"kind":"flow","direction":"RIGHT","nodes":[{"id":"a","text":"Short name","detail":"Shown on click"}],"edges":[{"from":"a","to":"b","label":"optional"}]}. Other kinds (tree, mindmap, lanes, grid, board, quadrant, timeline, gantt, sequence, fishbone, funnel, stack, cycle) have their own fields: see toucan_templates.',
		inputSchema: object({ ...canvas, spec: { type: 'object', description: 'The diagram, in the same form as a template.' }, update: { type: 'boolean', description: 'This is a new version of an earlier drawing.' }, move: { type: 'boolean', description: 'With update, also reposition its boxes.' }, label: { type: 'string', description: "Names the edit in the canvas's history." } }, ['spec']),
		argv: (a) => [...on(a), 'draw', '-', ...bool('--update', a.update), ...bool('--move', a.move), ...opt('--label', a.label)],
		stdin: (a) => JSON.stringify(a.spec),
	},
	{
		name: 'toucan_import',
		description: 'Merge a graph into the canvas by key. A small Mermaid flowchart is a good way to add or relabel. Existing shapes keep their place; nothing is deleted without prune.',
		inputSchema: object({ ...canvas, content: { type: 'string', description: 'The graph, as text.' }, format: { type: 'string', enum: ['mermaid', 'jsoncanvas', 'excalidraw', 'tg'], description: 'Default: mermaid.' }, propose: { type: 'boolean', description: 'What it adds arrives dashed, for the person to accept or reject. Use this for opinions and broad changes.' }, move: { type: 'boolean' }, prune: { type: 'boolean', description: "Delete what isn't in the graph." }, label: { type: 'string' } }, ['content']),
		argv: (a) => [...on(a), 'import', '-', '--format', a.format ?? 'mermaid', ...bool('--propose', a.propose), ...bool('--move', a.move), ...bool('--prune', a.prune), ...opt('--label', a.label)],
		stdin: (a) => a.content,
	},
	{
		name: 'toucan_exec',
		description: "Run JavaScript in the live editor, with `editor`, `tl` and `toucan` (helpers such as toucan.node, toucan.edge, toucan.frame) in scope; `return` a JSON value. One call is one undo step for the person, so make one call per idea.",
		inputSchema: object({ ...canvas, code: { type: 'string' }, label: { type: 'string', description: "Names the edit in the canvas's history." } }, ['code']),
		argv: (a) => [...on(a), 'exec', '-', ...opt('--label', a.label)],
		stdin: (a) => a.code,
	},
	{
		name: 'toucan_graph',
		description: 'Export the canvas as text.',
		inputSchema: object({ ...canvas, format: { type: 'string', enum: ['tg', 'mermaid', 'jsoncanvas', 'dot', 'excalidraw'], description: 'Default: mermaid.' } }),
		readOnly: true,
		argv: (a) => [...on(a), 'graph', '--format', a.format ?? 'mermaid'],
	},
	{
		name: 'toucan_routines',
		description: "The routines you can run instead of writing the code yourself, grouped by kind (tidy, arrows, layout, style, content, check), each with when to use it. Check here before doing a chore by hand. With suggest: true, the chores agents keep doing by hand that are worth banking.",
		inputSchema: object({ kind: { type: 'string', description: 'Only this kind.' }, suggest: { type: 'boolean', description: 'Habits worth banking, from the work log.' } }),
		readOnly: true,
		argv: (a) => ['routine', ...(a.suggest ? ['suggest'] : ['list', ...(a.kind ? ['--kind', String(a.kind)] : [])])],
	},
	{
		name: 'toucan_run_routine',
		description: 'Run a banked routine on the canvas: one undo step, shown to people as yours.',
		inputSchema: object({ ...canvas, name: { type: 'string', description: 'The routine, from toucan_routines.' }, args: { type: 'object', description: "The routine's arguments, if it takes any." } }, ['name']),
		argv: (a) => [...on(a), 'routine', 'run', checkCanvas(a.name), ...(a.args ? ['--args', JSON.stringify(a.args)] : [])],
	},
	{
		name: 'toucan_templates',
		description: 'The diagrams toucan knows how to lay out, or one of them in full to copy the form of.',
		inputSchema: object({ id: { type: 'string', description: 'Show this template.' } }),
		readOnly: true,
		argv: (a) => ['templates', ...(a.id ? ['show', checkCanvas(a.id)] : [])],
	},
	{
		name: 'toucan_cli',
		description: `Any other toucan command, as command-line arguments: what people selected (selection), sticky notes (notes), comment threads (threads), proposals, version history (versions), routines (routine), canvas scripts (script), meta, new, files. For example ["--canvas","x","threads","reply","3","done"]. Code for script put or routine save goes through stdin, with - as the file. Allowed commands: ${CLI_ALLOWED.join(', ')}.`,
		inputSchema: object({ args: { type: 'array', items: { type: 'string' } }, stdin: { type: 'string', description: 'Standard input, for commands reading a file named -.' } }, ['args']),
		argv: (a) => checkCli(a.args),
		stdin: (a) => a.stdin,
	},
]

function opt(flag, value) {
	return typeof value === 'string' && value ? [flag, value] : []
}
function bool(flag, value) {
	return value ? [flag] : []
}
function on(a) {
	return a.canvas ? ['--canvas', checkCanvas(a.canvas)] : []
}

function cli(argv, { stdin, cwd } = {}) {
	return new Promise((resolve) => {
		const child = execFile(process.execPath, [join(ROOT, 'bin/toucan.mjs'), ...argv], { cwd, maxBuffer: 256 << 20, timeout: 180000, env: { ...process.env, TOUCAN_VIA_MCP: '1' } }, (err, stdout, stderr) => {
			resolve(err ? { error: (stderr || err.message).replace(/^toucan: /, '').trim() } : { out: stdout.trim() })
		})
		child.stdin.on('error', () => {})
		child.stdin.end(stdin ?? '')
	})
}

async function callTool(name, a) {
	a = a && typeof a === 'object' ? a : {}
	const tool = TOOLS.find((t) => t.name === name)
	if (!tool) throw Object.assign(new Error(`no tool ${name}`), { code: -32602 })
	const fail = (text) => ({ content: [{ type: 'text', text }], isError: true })
	if (tool.image) {
		let target
		try {
			target = on(a)
		} catch (e) {
			return fail(e.message)
		}
		const dir = mkdtempSync(join(tmpdir(), 'toucan-mcp-'))
		try {
			const file = join(dir, 'canvas.png')
			const r = await cli([...target, 'screenshot', file, ...(a.keys?.length ? ['--keys', a.keys.join(',')] : [])])
			if (r.error) return fail(r.error)
			return { content: [{ type: 'image', mimeType: 'image/png', data: readFileSync(file).toString('base64') }] }
		} finally {
			rmSync(dir, { recursive: true, force: true })
		}
	}
	let argv
	try {
		argv = tool.argv(a)
	} catch (e) {
		return fail(e.message)
	}
	const r = await cli(argv, { stdin: tool.stdin?.(a), cwd: tool.cwd?.(a) })
	return r.error ? fail(r.error) : { content: [{ type: 'text', text: r.out }] }
}

const annotated = ({ name, description, inputSchema, readOnly }) => ({ name, description, inputSchema, annotations: { readOnlyHint: !!readOnly } })

/** Answer one message; a notification gets nothing. Exported so the protocol can be tested without a process. */
export async function handle(msg, send) {
	const { id, method, params } = msg
	if (id === undefined) return
	const ok = (result) => send({ jsonrpc: '2.0', id, result: { resultType: 'complete', _meta: { 'io.modelcontextprotocol/serverInfo': SERVER }, ...result } })
	const fail = (code, message, data) => send({ jsonrpc: '2.0', id, error: { code, message, ...(data && { data }) } })
	const asked = params?._meta?.['io.modelcontextprotocol/protocolVersion']
	if (asked && ![...MODERN, ...LEGACY].includes(asked)) return fail(-32022, `unsupported protocol version ${asked}`, { supported: [...MODERN, ...LEGACY], requested: asked })
	try {
		switch (method) {
			case 'initialize': {
				const v = params?.protocolVersion
				return ok({ protocolVersion: LEGACY.includes(v) ? v : LEGACY[0], capabilities: { tools: {} }, serverInfo: SERVER, instructions: INSTRUCTIONS })
			}
			case 'server/discover':
				return ok({ supportedVersions: [...MODERN, ...LEGACY], capabilities: { tools: {} }, instructions: INSTRUCTIONS, ttlMs: 3600000, cacheScope: 'public' })
			case 'ping':
				return ok({})
			case 'tools/list':
				return ok({ tools: TOOLS.map(annotated), ttlMs: 3600000, cacheScope: 'public' })
			case 'tools/call':
				return ok(await callTool(params?.name, params?.arguments))
			default:
				return fail(-32601, `no method ${method}`)
		}
	} catch (e) {
		return fail(e.code ?? -32603, e.message)
	}
}

export function serve() {
	const send = (m) => process.stdout.write(JSON.stringify(m) + '\n')
	const rl = createInterface({ input: process.stdin })
	const running = new Set()
	rl.on('line', (line) => {
		if (!line.trim()) return
		let msg
		try {
			msg = JSON.parse(line)
		} catch {
			return send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'not JSON' } })
		}
		if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return send({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'not a JSON-RPC message' } })
		const p = handle(msg, send).finally(() => running.delete(p))
		running.add(p)
	})
	// Let calls already running finish after the client hangs up.
	rl.on('close', () => Promise.allSettled([...running]).then(() => process.exit(0)))
}
