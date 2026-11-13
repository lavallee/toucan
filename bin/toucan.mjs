#!/usr/bin/env node
// toucan CLI — how agents (Codex in the chat panel, or Claude Code / Codex / pi in a
// terminal) read and change a canvas that is open in a browser tab (or, on a server started
// with --headless, in the server's own headless page when no tab is open).
//
//   Getting going:
//     setup [--data DIR] [--browser] [--no-agents] [--no-open]   get this machine ready: server, agents, a first canvas
//     init [NAME] [--title T] [--template ID] [--engine E] [--open]   the canvas for the project you're in; later commands here use it
//     open [NAME]                 open a canvas (or the index) in your browser, signed in
//     agents [install [ID...] [--mcp] [--force] | remove [ID...]]   connect the agents on this machine (skill; MCP where it's needed)
//     mcp                         run as an MCP server on stdio, for agents that can't run the CLI
//     guide                       the full guide for agents
//     status                      is the server running, and where
//     start [--port P] [--host H] [--data DIR] [--no-headless] [--take-over] | stop | restart   the background server (commands start it when needed)
//     doctor                      check this install, and say what to do about anything wrong
//     update                      install the latest release
//     --version
//
//   toucan [--canvas NAME] <command>     (the canvas: --canvas, then TOUCAN_CANVAS, then this project's from `toucan init`)
//     url                         sign-in link for the browser (opens the index of canvases)
//     canvases                    list canvases: title, shapes, scripts, open tabs
//     new NAME [--engine tldraw|excalidraw] [--from CANVAS|FILE | --template ID] [--title T] [--description D] [--canvas-format F]
//     new NAME --plan SOURCE REF [--views board,gantt]   a canvas over a plan, with views of it (a file plan given by path is copied in)
//     templates [show ID]         starters (whole canvases) and blocks (one diagram each) to start from or add (show: one in full, as an example)
//     add TEMPLATE                put a block or a starter on --canvas, beside what's there
//     draw FILE|- [--update] [--move] [--label T]   lay out a diagram described as data (same form as a template) onto --canvas
//                                 make a canvas; --from copies another canvas (or a graph file) via TG
//     graph [--format tg|jsoncanvas|mermaid|dot|excalidraw] [OUT]   export (no tab needed)
//     import FILE|- [--format F] [--move] [--prune] [--propose] [--label T]   keyed upsert of a graph file into the open canvas
//                                 (--propose: what it adds arrives dashed, as a proposal)
//     meta [--title T] [--description D] [--canvas-format story|ideas|system|none]   retitle, describe or set --canvas's format
//     meta --profile SOURCE/ID|none   work on --canvas with a named agent: its knowledge, briefing and skills (see profiles)
//     profiles                    the named agents canvases can work with, from <data>/_profiles/ and toucan-profiles-* sources
//     profiles add ID --workdir DIR [--name N] [--context FILE,FILE]   an agent of your own, from its folder (starts with its AGENTS.md)
//     profile                     the agent --canvas works with: what it reads at the start, and its skills
//     archive                     move --canvas aside to canvases/.archive/ (no tabs may have it open)
//     summary [--within KEY]      compact JSON of shapes on the page
//     exec -e CODE | FILE | - [--label TEXT]   run JS in the live editor; `return` a JSON value (--label names it in the history)
//     screenshot [OUT.png]        PNG of the page (or --keys a,b; --max px, default 1800)
//     animate [OUT.gif]           GIF of the page building up, box by box along the arrows (--step ms, --hold ms, --max px)
//     script list | put NAME FILE | rm NAME     canvas scripts (persistent behaviour)
//     proposals [accept|reject [KEY...]]   dashed = proposed: list, or accept (solid) / reject (remove)
//     selection                   what people have selected (to resolve "this"), in the tab you run in and others
//     notes [--all]               sticky notes left for the agent, with the shapes they sit on and near
//     notes resolve KEY --reply TEXT   mark a note handled: green, plus a one-line reply (never deleted)
//     log [--since T]             edits agents made with no tab open (T: ISO time, or 30m, 2h, 7d ago)
//     versions [save LABEL | show N [--format F] | restore N]   the canvas's history: step back, name a point, restore one
//     threads [--all] | show N | new TEXT --on KEY,KEY | --region X,Y,W,H [--ask] | reply N TEXT [--ask] | close N [--reply T] | reopen N | adopt-notes
//                                 comment threads on shapes and regions (--as NAME: speak as a person; default: as the agent)
//     files                       where this canvas keeps what agents write for it, and what's there
//     routine list [--kind K] | show NAME | run NAME [--args JSON] | save NAME FILE [--title T] [--description D] [--engines E] [--kind K] [--when TEXT] [--takes TEXT] | rm NAME
//     routine suggest [--since 30d] [--min N]   chores agents keep doing by hand, worth banking (from the work log)
//     routine stats [--since 30d]                which routines get used, by whom, and how often they fail
//     routine learn --codex [DIR] [--since 30d]  bring the chat agent's past Codex sessions into the work log, so suggest sees them
//                                 chores banked once and run on any canvas (no --canvas needed to list, show, save or rm)
//     say TEXT [--at KEY,KEY]     tell people what you're about to do; --at moves your cursor to those shapes
//     plugins                     every plugin on PATH by kind (profiles, plan sources), with any found but refused and why; and extension commands
//     sources                     where plans can come from: the built-in file source, and toucan-source-* adapters with what each lists
//     plan                        the plan --canvas shows: source, state, views, problems
//     plan bind SOURCE REF [--views board,gantt] [--copy] | unbind | sync | dismiss
//     plan catalog                the kinds of view and their options, as an agent needs them
//     plan views | view add KIND [options] | view set ID [options] | view put FILE|- | view rm ID [--keep]
//                                 options: --id --title --group-by F --lanes F --rollup count,done,sum:F --filter EXPR|JSON --sort F,-G --fields a,b --color F
//                                 --scale day|week|month|auto --from DATE --to DATE --[no-]dependencies --[no-]hide-empty --date F --per-row N --direction RIGHT|DOWN
//     plan items [--json]         the plan's fields and items
//     plan set ITEM field=value... [--after ID | --first]   change an item upstream (an option by id or label; empty clears)
//     plan add --title T [field=value...] [--after ID | --first]   make an item upstream
//     references                  what people can read beside this canvas: its files, its project's, links on it
//     show REF|PATH|URL           open it for people, in the References panel beside the canvas
//
//   --agent NAME (or TOUCAN_AGENT) names you on the canvas: the status pill, your cursor, the glow's tag.
//
//   Any other command runs `toucan-<command>` from PATH with the same arguments and
//   TOUCAN_CANVAS set, so extensions live in their own repos (see README, "Extending").

import { readFileSync, writeFileSync, existsSync, statSync, mkdirSync, mkdtempSync, accessSync, constants, copyFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { FORMATS } from '../lib/tg.mjs'
import { connect } from '../lib/client.mjs'
import * as control from '../lib/control.mjs'
import { chooseCanvas, findProject, linkProject, projectRoot, tooGeneral } from '../lib/projects.mjs'
import { openInBrowser } from '../lib/open.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const argv = process.argv.slice(2)
const flag = (name, fallback) => {
	const i = argv.indexOf(`--${name}`)
	if (i < 0) return fallback
	const v = argv[i + 1]
	argv.splice(i, v === undefined || v.startsWith('--') ? 1 : 2)
	return v === undefined || v.startsWith('--') ? true : v
}
const named = flag('canvas', process.env.TOUCAN_CANVAS || undefined)
const server = flag('server', process.env.TOUCAN_URL || undefined)
const agent = flag('agent', process.env.TOUCAN_AGENT || undefined)
for (const [name, value] of [['canvas', named], ['server', server], ['agent', agent]]) if (value === true) die(`--${name} needs a value`)
// Inside a project with a canvas, that's the canvas. Not something anyone typed, so `url` can tell the difference.
let here
try {
	here = process.cwd()
} catch {} // the directory has gone: nothing here can be a project
const canvas = named ?? (here && findProject(here)?.canvas)
const [cmd, ...rest] = argv
// Positional arguments after the command, once a case has consumed its flags.
const positional = () => argv.slice(1)

function die(msg) {
	console.error(`toucan: ${msg}`)
	process.exit(1)
}

// Needs a server to talk to, and starts one if there's none.
const BUILTIN = ['url', 'canvases', 'summary', 'exec', 'screenshot', 'script', 'new', 'meta', 'graph', 'import', 'archive', 'notes', 'selection', 'proposals', 'log', 'versions', 'routine', 'threads', 'files', 'templates', 'draw', 'init', 'open', 'say', 'references', 'show', 'profiles', 'profile', 'add', 'animate', 'plan', 'sources', 'plugins']
// Works without one, or manages it.
const LOCAL = ['setup', 'doctor', 'agents', 'mcp', 'guide', 'status', 'start', 'stop', 'restart', 'update', 'version', '--version', '-v', 'help', '--help', '-h']
let client
if (cmd && !BUILTIN.includes(cmd) && !LOCAL.includes(cmd)) {
	// The name goes on the end of `toucan-`, so it must not be able to say anywhere else to run.
	if (!/^[a-z0-9][a-z0-9-]*$/i.test(cmd)) die(`unknown command ${cmd}`)
	// An extension command: `toucan foo …` runs `toucan-foo …` from PATH.
	const r = spawnSync(`toucan-${cmd}`, rest, { stdio: 'inherit', env: { ...process.env, ...(canvas && { TOUCAN_CANVAS: canvas }), ...(server && { TOUCAN_URL: server }) } })
	if (r.error?.code !== 'ENOENT') process.exit(r.error ? (console.error(`toucan: ${r.error.message}`), 1) : (r.status ?? 1))
} else if (BUILTIN.includes(cmd)) {
	try {
		if (!server) await control.ensure()
		client = connect({ canvas, server, agent })
	} catch (e) {
		die(e.message)
	}
}
const cfg = client?.cfg
const call = (...a) => client.call(...a).catch((e) => die(e.message))
const exec = (...a) => client.exec(...a).catch((e) => die(e.message))
const cpath = (sub) => {
	try {
		return client.path(sub)
	} catch (e) {
		die(e.message)
	}
}

/** A graph file in any importable format, as TG. The format comes from --format or the extension. */
function readGraph(file, format) {
	const src = readFileSync(file === '-' ? 0 : file, 'utf8')
	format ??= file.endsWith('.canvas') ? 'jsoncanvas' : /\.(mmd|mermaid)$/.test(file) ? 'mermaid' : file.endsWith('.excalidraw') ? 'excalidraw' : 'tg'
	if (!FORMATS[format]?.import) die(`can't import ${format}; importable: ${Object.keys(FORMATS).filter((f) => FORMATS[f].import).join(', ')}`)
	return FORMATS[format].import(src)
}

/** `.toucan/` in a checkout, which is ignored there; an npm install's directory may not be writable, or shouldn't be written to. */
function screenshotDir() {
	const dir = join(ROOT, '.toucan')
	try {
		if (!existsSync(join(ROOT, '.git'))) throw new Error('not a checkout')
		mkdirSync(dir, { recursive: true })
		accessSync(dir, constants.W_OK)
		return dir
	} catch {
		return mkdtempSync(join(tmpdir(), 'toucan-')) // private to this user, unlike a shared name in /tmp
	}
}

const print = (v) => console.log(typeof v === 'string' ? v : JSON.stringify(v, null, 2))

/** Binds a canvas to a plan. A file plan may be named by a path on this machine: sent as it is, or copied into the canvas's files. */
async function bindPlan(name, source, ref, { views = [], copy = false } = {}) {
	const at = `/api/canvases/${encodeURIComponent(name)}`
	const body = { name: source, views }
	if (source === 'file' && !/^(files|project(-\d+)?)\//.test(ref) && existsSync(ref) && statSync(ref).isFile()) {
		if (copy) {
			const { dir } = await call(`${at}/files`)
			const file = `${basename(ref).replace(/(\.plan)?\.json$/, '')}.plan.json`
			mkdirSync(dir, { recursive: true })
			copyFileSync(ref, join(dir, file))
			body.ref = `files/${file}`
			console.error(`toucan: copied ${ref} to ${join(dir, file)}; that copy is the plan now, and edits on the canvas are written to it`)
		} else body.path = resolve(ref)
	} else body.ref = ref
	return call(`${at}/plan/bind`, { method: 'POST', body: JSON.stringify(body) })
}
const viewKinds = (list) => (typeof list === 'string' ? list.split(',').map((k) => k.trim()).filter(Boolean).map((kind) => ({ kind })) : [])
/** A view's options from the command line. `none` (or an empty value) takes an option away, except where "none" is a value. */
function viewFlags() {
	const out = {}
	const take = (name, key, { keepNone = false, number = false } = {}) => {
		const v = flag(name)
		if (v === undefined) return
		if (v === true) die(`--${name} needs a value`)
		out[key] = !keepNone && (v === 'none' || v === '') ? null : number ? Number(v) : v
	}
	take('id', 'id')
	take('title', 'title')
	take('group-by', 'groupBy', { keepNone: true })
	take('lanes', 'lanes', { keepNone: true })
	take('rollup', 'rollup')
	take('color', 'color', { keepNone: true })
	take('filter', 'filter')
	take('sort', 'sort')
	take('fields', 'fields')
	take('scale', 'scale')
	take('from', 'from')
	take('to', 'to')
	take('date', 'date')
	take('direction', 'direction')
	take('per-row', 'perRow', { number: true })
	for (const [name, key] of [['dependencies', 'dependencies'], ['hide-empty', 'hideEmpty']]) {
		if (flag(name)) out[key] = true
		if (flag(`no-${name}`)) out[key] = false
	}
	return out
}
/** field=value arguments as a `set`. Values go as typed: the server reads an option by id or label, and an empty value clears. */
function fieldArgs(args) {
	const set = {}
	for (const a of args) {
		const i = a.indexOf('=')
		if (i < 1) die(`"${a}": write a change as field=value`)
		set[a.slice(0, i)] = a.slice(i + 1) === '' ? null : a.slice(i + 1)
	}
	return set
}

switch (cmd) {
	case 'url': {
		print(`${client.url(named ?? null)}#token=${cfg.token}`)
		break
	}
	case 'open': {
		const [name] = positional()
		const target = name ?? canvas ?? null
		const url = client.url(target)
		if (!(await openInBrowser(`${url}#token=${cfg.token}`))) {
			// No screen here (over ssh, say), so the person has to take the link elsewhere. An agent over MCP
			// shouldn't have the token in its transcript: someone at a terminal can print it.
			if (process.env.TOUCAN_VIA_MCP) print(`can't open a browser from here. The canvas is at ${url}. If the person isn't signed in on that browser, they can run \`toucan url\` for a link that does it.`)
			else print(`can't open a browser from here. Open this one, which signs you in:\n${url}#token=${cfg.token}`)
			break
		}
		print(`opened ${url}`)
		// Agents usually open a canvas to work on it: give the tab a moment to connect, so their next run lands there.
		for (let i = 0; target && i < 40; i++) {
			const c = (await call('/api/canvases')).canvases.find((x) => x.name === target)
			if (!c || c.open) break
			await new Promise((r) => setTimeout(r, 250))
		}
		break
	}
	case 'init': {
		const title = flag('title'), description = flag('description'), engine = flag('engine'), template = flag('template'), canvasFormat = flag('canvas-format'), wantOpen = !!flag('open')
		const [name] = positional()
		if (!here) die("the directory you're in no longer exists")
		const root = projectRoot(here)
		if (tooGeneral(root) && !name) die(`${root} is too general to be one project. Run this inside a project, or name a canvas with \`toucan new NAME\`.`)
		const existing = (await call('/api/canvases')).canvases.map((c) => c.name)
		const { canvas: chosen, create } = chooseCanvas({ root, name, existing })
		if (create) {
			await call('/api/canvases', { method: 'POST', body: JSON.stringify({ name: chosen, title: typeof title === 'string' ? title : basename(root), description, ...(typeof engine === 'string' && { engine }), ...(typeof canvasFormat === 'string' && { format: canvasFormat }), ...(typeof template === 'string' && { template }) }) })
		}
		if (!tooGeneral(root)) linkProject(root, chosen)
		const target = connect({ canvas: chosen, server })
		const url = target.url(chosen)
		const opened = wantOpen && (await openInBrowser(`${url}#token=${cfg.token}`))
		print({ canvas: chosen, created: create, project: root, url, opened: !!opened, files: (await call(`/api/canvases/${encodeURIComponent(chosen)}/files`)).dir })
		break
	}
	case 'canvases':
		print((await call('/api/canvases')).canvases.map(({ thumb, ...c }) => c))
		break
	case 'summary': {
		const within = flag('within')
		print(await exec(`return toucan.summary(${JSON.stringify({ within: within || undefined })})`, undefined, undefined, 'reading the canvas'))
		break
	}
	case 'exec': {
		const label = flag('label')
		const args = positional()
		const i = args.findIndex((a) => a === '-e' || a === '--eval')
		const src = i >= 0 ? args[i + 1] : args[0] === '-' || !args[0] ? readFileSync(0, 'utf8') : readFileSync(args[0], 'utf8')
		if (src === undefined) die('usage: exec -e CODE | FILE | - [--label TEXT]')
		print(await exec(src, 120000, typeof label === 'string' ? label : undefined, typeof label === 'string' ? label : 'editing the canvas'))
		break
	}
	case 'screenshot': {
		const keys = flag('keys')
		const max = Number(flag('max', 1800))
		const out = positional()[0] ?? join(screenshotDir(), `${canvas}.png`)
		const b64 = await exec(`return toucan.screenshot(${JSON.stringify({ keys: keys ? String(keys).split(',') : null, max })})`, undefined, undefined, 'looking at the canvas')
		if (!b64) die('canvas is empty')
		writeFileSync(out, Buffer.from(b64, 'base64'))
		print(out)
		break
	}
	case 'animate': {
		// An animated build of the canvas as a GIF: boxes appear in the order the arrows go (app/animate.js). Nothing changes.
		const opts = { max: Number(flag('max', 1200)), step: Number(flag('step', 700)), hold: Number(flag('hold', 2500)) }
		const out = positional()[0] ?? join(screenshotDir(), `${canvas}.gif`)
		const r = await exec(`return toucan.animate(${JSON.stringify(opts)})`, 180000, undefined, 'making an animated GIF')
		if (!r) die('canvas is empty')
		writeFileSync(out, Buffer.from(r.gif, 'base64'))
		print(`${out}  (${r.frames} frames, ${r.width}x${r.height})`)
		break
	}
	case 'script': {
		const [sub, name, file] = rest
		if (sub === 'list') print((await call(cpath(`/scripts`))).scripts.map((s) => s.name))
		else if (sub === 'put' && name && file) {
			await call(cpath(`/scripts/${name}`), { method: 'PUT', body: readFileSync(file === '-' ? 0 : file, 'utf8') })
			print(`installed ${name} on ${canvas}`)
		} else if (sub === 'rm' && name) {
			await call(cpath(`/scripts/${name}`), { method: 'DELETE' })
			print(`removed ${name}`)
		} else die('usage: script list | put NAME FILE | rm NAME')
		break
	}
	case 'new': {
		const title = flag('title'), description = flag('description'), engine = flag('engine', 'tldraw'), from = flag('from'), canvasFormat = flag('canvas-format'), template = flag('template')
		const [name] = positional()
		if (!name) die('usage: new NAME [--engine tldraw|excalidraw] [--from CANVAS|FILE] [--title T] [--description D]')
		const seed = from && existsSync(from) && statSync(from).isFile() ? { graph: readGraph(from, flag('format')) } : from ? { from } : {}
		const planSource = flag('plan'), planViews = flag('views')
		const planRef = positional()[1]
		if (planSource !== undefined && (planSource === true || !planRef)) die('usage: new NAME --plan SOURCE REF [--views board,gantt]   (see `toucan sources`)')
		await call('/api/canvases', { method: 'POST', body: JSON.stringify({ name, title, description, engine, ...seed, ...(canvasFormat && { format: canvasFormat }), ...(typeof template === 'string' && { template }) }) })
		if (planSource) {
			const bound = await bindPlan(name, planSource, planRef, { views: viewKinds(planViews === undefined ? 'board' : planViews), copy: true })
			console.error(`toucan: ${name} shows "${bound.source.title}" (${bound.items} items) as ${bound.views.map((v) => v.id).join(', ') || 'no views yet'}${bound.state === 'waiting' ? '; the views are drawn when the canvas is opened' : ''}`)
		}
		print(`made ${name} — open ${client.url(name)}`)
		break
	}
	case 'meta': {
		const title = flag('title'), description = flag('description'), canvasFormat = flag('canvas-format'), profile = flag('profile')
		if (profile === true) die('usage: meta --profile SOURCE/ID|none   (see `toucan profiles`)')
		print(await call(cpath(`/meta`), { method: 'PATCH', body: JSON.stringify({ title, description, ...(canvasFormat && { format: canvasFormat === 'none' ? '' : canvasFormat }), ...(typeof profile === 'string' && { profile: profile === 'none' ? '' : profile }) }) }))
		break
	}
	case 'profiles': {
		const [, sub, id] = argv
		if (sub === 'add') {
			// An agent of your own, from its folder: what most people need, with no registry.
			const workdir = flag('workdir')
			if (!id || typeof workdir !== 'string') die('usage: profiles add ID --workdir DIR [--name N] [--description D] [--instructions TEXT] [--context FILE,FILE]')
			const context = flag('context'), name = flag('name'), description = flag('description'), instructions = flag('instructions')
			const made = await call('/api/profiles', { method: 'POST', body: JSON.stringify({ id, workdir: resolve(workdir), ...(typeof name === 'string' && { name }), ...(typeof description === 'string' && { description }), ...(typeof instructions === 'string' && { instructions }), ...(typeof context === 'string' && { context: context.split(',') }) }) })
			print(made)
			console.error(`toucan: work with ${made.name} on a canvas with \`toucan --canvas NAME meta --profile ${made.ref}\`, or pick it in the chat panel`)
		} else if (!sub) print(await call('/api/profiles'))
		else die('usage: profiles [add ID --workdir DIR]')
		break
	}
	case 'profile':
		print((await call(cpath('/profile'))).profile)
		break
	case 'plugins': {
		// What the server found, and, from this shell's own PATH, the extension commands `toucan NAME` would run.
		const { scanCommands } = await import('../server/plugins.mjs')
		print({ ...(await call('/api/plugins')), commands: scanCommands() })
		break
	}
	case 'sources':
		print((await call(`/api/sources${canvas ? `?canvas=${encodeURIComponent(canvas)}` : ''}`)).sources)
		break
	case 'plan': {
		const [, sub] = argv
		const post = (path, body) => call(cpath(`/plan${path}`), { method: 'POST', body: JSON.stringify(body ?? {}) })
		// What a write came to: the items as they now stand, or the refusal, as the reason this command failed.
		const written = (r) => {
			const bad = r.results.filter((x) => !x.ok)
			if (bad.length) die(bad.map((x) => `${x.error}: ${x.message ?? 'refused'}`).join('\n'))
			print(r.results.map((x) => x.item))
		}
		if (!sub) print(await call(cpath('/plan')))
		else if (sub === 'catalog') print((await call('/api/plan/catalog')).text)
		else if (sub === 'bind') {
			const views = flag('views'), copy = !!flag('copy')
			const [, , source, ref] = argv
			if (!source || !ref) die('usage: plan bind SOURCE REF [--views board,gantt] [--copy]   (see `toucan sources`; a file plan is files/PATH or project/PATH)')
			print(await bindPlan(canvas ?? die('which canvas? Pass --canvas NAME'), source, ref, { views: viewKinds(views), copy }))
		} else if (sub === 'unbind') print(await call(cpath('/plan'), { method: 'DELETE' }))
		else if (sub === 'sync') print(await post('/sync'))
		else if (sub === 'dismiss') print(await call(cpath('/plan/problems'), { method: 'DELETE' }))
		else if (sub === 'views') print((await call(cpath('/plan/views'))).views)
		else if (sub === 'view') {
			const keep = !!flag('keep')
			const opts = viewFlags()
			const [, , verb, what] = argv
			if (verb === 'add' && what) print((await post('/views', { ...opts, kind: what })).view)
			else if (verb === 'set' && what) print((await call(cpath(`/plan/views/${encodeURIComponent(what)}`), { method: 'PATCH', body: JSON.stringify(opts) })).view)
			else if (verb === 'put' && what) print((await post('/views', JSON.parse(readFileSync(what === '-' ? 0 : what, 'utf8')))).view)
			else if (verb === 'rm' && what) print((await call(cpath(`/plan/views/${encodeURIComponent(what)}${keep ? '?keep' : ''}`), { method: 'DELETE' })).views)
			else die('usage: plan view add KIND [options] | set ID [options] | put FILE|- | rm ID [--keep]   (`plan catalog` lists kinds and options)')
		} else if (sub === 'items') {
			if (flag('json')) print(await call(cpath('/plan/items')))
			else print((await call(cpath('/plan/items?text'))).text)
		} else if (sub === 'set' || sub === 'add') {
			const after = flag('after'), first = !!flag('first'), title = flag('title')
			const place = first ? { after: null } : typeof after === 'string' ? { after } : undefined
			const args = argv.slice(2)
			if (sub === 'set') {
				const [id, ...fields] = args
				if (!id || (!fields.length && !place && typeof title !== 'string')) die('usage: plan set ITEM field=value... [--after ID | --first]')
				written(await post('/write', { changes: [{ op: 'update', id, set: { ...fieldArgs(fields), ...(typeof title === 'string' && { title }) }, ...(place && { place }) }] }))
			} else {
				if (typeof title !== 'string') die('usage: plan add --title T [field=value...] [--after ID | --first]')
				written(await post('/write', { changes: [{ op: 'create', set: { ...fieldArgs(args), title }, ...(place && { place }) }] }))
			}
		} else die('usage: plan [bind SOURCE REF | unbind | sync | catalog | views | view add|set|put|rm | items | set ITEM f=v | add --title T | dismiss]')
		break
	}
	case 'graph': {
		const format = flag('format', 'tg')
		if (!FORMATS[format]?.export) die(`--format: one of ${Object.keys(FORMATS).filter((f) => FORMATS[f].export).join(', ')}`)
		const out = await call(cpath(`/graph?format=${format}${flag('raw') ? '&raw' : ''}`), {}, { text: format !== 'tg' })
		const text = typeof out === 'string' ? out : JSON.stringify(out, null, 2) + '\n'
		if (positional()[0]) {
			writeFileSync(positional()[0], text)
			print(positional()[0])
		} else process.stdout.write(text)
		break
	}
	case 'import': {
		const file = positional()[0]
		if (!file) die('usage: import FILE [--format tg|jsoncanvas|mermaid|excalidraw] [--move] [--prune] [--propose]')
		const tg = readGraph(file, flag('format'))
		if (tg.warnings?.length) console.error(`toucan: ${tg.warnings.length} line(s) not understood:\n  ${tg.warnings.join('\n  ')}`)
		const opts = { move: !!flag('move'), prune: !!flag('prune'), propose: !!flag('propose') }
		const named = flag('label')
		const label = typeof named === 'string' ? named : ['import', file === '-' ? 'from stdin' : basename(file), opts.move && '--move', opts.prune && '--prune', opts.propose && '--propose'].filter(Boolean).join(' ')
		print(await exec(`return await toucan.applyGraph(${JSON.stringify(tg)}, ${JSON.stringify(opts)})`, 120000, label, typeof named === 'string' ? named : `${opts.propose ? 'proposing' : 'importing'} ${file === '-' ? 'a graph' : basename(file)}`))
		break
	}
	case 'proposals': {
		const [, sub, ...keys] = argv
		if (!sub) print(await exec('return toucan.proposals()', undefined, undefined, 'reading the proposals'))
		else if (sub === 'accept' || sub === 'reject') print(await exec(`return toucan.${sub}(...${JSON.stringify(keys)})`, undefined, undefined, `${sub === 'accept' ? 'accepting' : 'rejecting'} proposals`))
		else die('usage: proposals [accept|reject [KEY...]]   (no keys: all of them)')
		break
	}
	case 'selection':
		print(await exec('return toucan.selection()', undefined, undefined, 'looking at your selection'))
		break
	case 'notes': {
		const all = argv.includes('--all') && (argv.splice(argv.indexOf('--all'), 1), true)
		const reply = flag('reply')
		const [, sub, key] = argv
		const tldrawOnly = `if (toucan.engine !== 'tldraw') throw new Error('notes are a tldraw convention; this canvas runs ' + toucan.engine)\n`
		if (sub === 'resolve' && key && typeof reply === 'string') print(await exec(`${tldrawOnly}return toucan.resolveNote(${JSON.stringify(key)}, ${JSON.stringify(reply)})`, undefined, undefined, 'answering a note'))
		else if (!sub) print(await exec(`${tldrawOnly}return toucan.notes(${JSON.stringify({ all })})`, undefined, undefined, 'reading the notes'))
		else die('usage: notes [--all] | notes resolve KEY --reply TEXT')
		break
	}
	case 'say': {
		const at = flag('at')
		const text = positional().join(' ')
		if (!text && typeof at !== 'string') die('usage: say TEXT [--at KEY,KEY]')
		const r = await call(cpath('/say'), { method: 'POST', body: JSON.stringify({ agent, text, keys: typeof at === 'string' ? at.split(',') : [] }) })
		if (!r.tabs) console.error('toucan: nobody has this canvas open, so nobody saw that')
		break
	}
	case 'references': {
		const r = await call(cpath('/references'))
		print({ roots: r.roots, files: r.files.map((f) => f.ref), ...(r.cut && { cut: true }) })
		break
	}
	case 'show': {
		const [what] = positional()
		if (!what) die('usage: show REF|PATH|URL   (files/notes.md, project/README.md, a path inside either, or https://…)')
		// A reference as people would write one, or a path on disk that the server turns into one.
		const asRef = /^https?:\/\//i.test(what) || /^(files|(project|agent)(-\d+)?)\//.test(what)
		const r = await call(cpath('/show'), { method: 'POST', body: JSON.stringify({ agent, ...(asRef ? { ref: what } : { path: resolve(what) }) }) })
		if (!r.tabs) console.error('toucan: nobody has this canvas open, so nobody saw it')
		print({ shown: r.ref, tabs: r.tabs })
		break
	}
	case 'archive':
		print(await call(cpath(`/archive`), { method: 'POST' }))
		break
	case 'log': {
		// --since: an ISO time, epoch ms, or an age (30m, 2h, 7d).
		let since = flag('since', '')
		const age = /^(\d+)([smhd])$/.exec(since)
		if (age) since = new Date(Date.now() - age[1] * { s: 1e3, m: 6e4, h: 36e5, d: 864e5 }[age[2]]).toISOString()
		print((await call(cpath(`/log?since=${encodeURIComponent(since)}`))).entries)
		break
	}
	case 'versions': {
		const format = flag('format')
		const [, sub, arg, ...more] = argv
		if (!sub) print((await call(cpath('/versions'))).versions)
		else if (sub === 'save' && arg) print(await call(cpath('/versions'), { method: 'POST', body: JSON.stringify({ label: [arg, ...more].join(' '), source: 'agent' }) }))
		else if (sub === 'show' && arg) {
			const out = await call(cpath(`/versions/${arg}/graph?format=${format ?? 'tg'}`), {}, { text: !!format && format !== 'tg' })
			print(out)
		} else if (sub === 'restore' && arg) print(await call(cpath(`/versions/${arg}/restore`), { method: 'POST' }))
		else die('usage: versions [save LABEL | show N [--format F] | restore N]')
		break
	}
	case 'templates': {
		const [, sub, id] = argv
		if (sub === 'show' && id) print(await call(`/api/templates/${id}`))
		else if (!sub) {
			// Starters first (whole canvases), then blocks by what they're for.
			const { groups, templates } = await call('/api/templates')
			print({
				starters: templates.filter((t) => t.type === 'starter').map(({ id, title, use, parts }) => ({ id, title, use, has: parts })),
				blocks: groups.map((g) => ({ group: g.label, about: g.about, blocks: templates.filter((t) => t.type === 'block' && t.group === g.id).map(({ id, title, use }) => ({ id, title, use })) })),
			})
		} else die('usage: templates [show ID]')
		break
	}
	case 'draw': {
		const label = flag('label'), move = !!flag('move'), update = move || !!flag('update')
		const [, file] = argv
		if (!file) die('usage: draw FILE|- [--update] [--move] [--label T]')
		const { layOut, placeBeside } = await import('../lib/layouts.mjs')
		const spec = JSON.parse(readFileSync(file === '-' ? 0 : file, 'utf8'))
		const tg = await layOut(spec).catch((e) => die(e.message))
		// A new drawing goes beside what's there, and never over it. --update means this is a new version of what's there.
		const placed = update ? { prefix: null } : placeBeside(tg, await exec('const g = toucan.graph(); return { keys: [...g.nodes, ...g.groups].map((n) => n.key), boxes: [...g.nodes, ...g.groups].map((n) => n.box).filter(Boolean) }', undefined, undefined, 'finding room to draw'))
		const named = typeof label === 'string' ? label : `draw ${spec.title ?? spec.kind}`
		const out = await exec(`return await toucan.applyGraph(${JSON.stringify(tg)}, ${JSON.stringify({ move })})`, 120000, named, typeof label === 'string' ? label : `drawing ${spec.title ?? spec.kind}`)
		print(placed.prefix ? { ...out, keysPrefixed: placed.prefix } : out)
		break
	}
	case 'add': {
		// A block or a starter onto --canvas, beside what's there. Its content is an example to edit, not a placeholder.
		const [id] = positional()
		if (!id) die('usage: add TEMPLATE   (see `toucan templates`)')
		const r = await call(cpath('/add'), { method: 'POST', body: JSON.stringify({ template: id, agent }) })
		if (!r.ok) die(r.error)
		print(r)
		break
	}
	case 'files':
		print(await call(cpath('/files')))
		break
	case 'threads': {
		const all = !!flag('all'), on = flag('on'), region = flag('region'), reply = flag('reply'), as = flag('as'), ask = flag('ask')
		const author = typeof as === 'string' ? { kind: 'person', name: as } : { kind: 'agent' }
		const [, sub, ...args] = argv
		const post = (path, body) => call(cpath(`/threads${path}`), { method: 'POST', body: JSON.stringify({ author, ...body }) })
		if (!sub) print((await call(cpath(`/threads${all ? '?all' : ''}`))).threads)
		else if (sub === 'show' && args[0]) print(await call(cpath(`/threads/${args[0]}`)))
		else if (sub === 'new' && args.length && (on || region)) {
			const [x, y, w, h] = String(region).split(',').map(Number)
			print(await post('', { text: args.join(' '), anchor: on ? { shapes: String(on).split(',') } : { region: { x, y, w, h } }, ask: ask ? 'agent' : undefined }))
		} else if (sub === 'reply' && args[1]) print(await post(`/${args[0]}/messages`, { text: args.slice(1).join(' '), ask: ask ? 'agent' : undefined }))
		else if (sub === 'close' && args[0]) print(await post(`/${args[0]}/close`, { text: typeof reply === 'string' ? reply : undefined }))
		else if (sub === 'reopen' && args[0]) print(await post(`/${args[0]}/reopen`))
		else if (sub === 'adopt-notes') print(await post('/adopt-notes'))
		else die('usage: threads [--all] | show N | new TEXT --on KEY,KEY | --region X,Y,W,H [--ask] | reply N TEXT [--ask] | close N [--reply T] | reopen N | adopt-notes')
		break
	}
	case 'routine': {
		const title = flag('title'), description = flag('description'), engines = flag('engines'), args = flag('args')
		const kind = flag('kind'), when = flag('when'), takes = flag('takes'), since = flag('since'), min = flag('min'), engineFilter = flag('engine')
		const [, sub, name, file] = argv
		const query = (o) => Object.entries(o).filter(([, v]) => typeof v === 'string').map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')
		if (sub === 'list' || !sub) {
			// Grouped by kind, with when to use each: what an agent needs to pick one.
			const { kinds, routines: list } = await call(`/api/routines?${query({ kind, engine: engineFilter })}`)
			print(kinds.flatMap((k) => {
				const mine = list.filter((r) => r.kind === k.id)
				return mine.length ? [{ kind: k.id, about: k.about, routines: mine.map(({ name, title, when, args: a, engines: e, source }) => ({ name, title, when, ...(a && { args: a }), engines: e, ...(source === 'banked' && { banked: true }) })) }] : []
			}))
		} else if (sub === 'learn') {
			// Past work, so suggestions don't wait for new work to pile up: the chat agent's Codex sessions.
			const codex = flag('codex')
			if (!codex) die('usage: routine learn --codex [DIR] [--since 30d]   (DIR: Codex sessions, default ~/.codex/sessions)')
			const { readCodex } = await import('../lib/learn-codex.mjs')
			const { sinceMs } = await import('../server/worklog.mjs')
			const entries = readCodex(typeof codex === 'string' ? codex : undefined, { since: sinceMs(typeof since === 'string' ? since : undefined) })
			const { added } = await call('/api/routines/learn', { method: 'POST', body: JSON.stringify({ entries }) })
			print({ found: entries.length, added, canvases: [...new Set(entries.map((e) => e.canvas))].length })
			console.error('toucan: `toucan routine suggest` now includes this work')
		} else if (sub === 'suggest') print(await call(`/api/routines/suggestions?${query({ since, min })}`))
		else if (sub === 'stats') print(await call(`/api/routines/stats?${query({ since })}`))
		else if (sub === 'show' && name) print((await call(`/api/routines/${name}`)).code)
		else if (sub === 'run' && name) {
			const r = await call(cpath(`/routines/${name}/run`), { method: 'POST', body: JSON.stringify({ args: typeof args === 'string' ? JSON.parse(args) : undefined, agent }) })
			if (!r.ok) die(r.error)
			print(r.result ?? 'done')
		} else if (sub === 'save' && name && file) {
			const code = readFileSync(file === '-' ? 0 : file, 'utf8')
			const str = (v) => (typeof v === 'string' ? v : undefined)
			print(await call(`/api/routines/${name}`, { method: 'PUT', body: JSON.stringify({ code, title, description, engines: typeof engines === 'string' ? engines.split(/[,\s]+/) : undefined, kind: str(kind), when: str(when), args: str(takes) }) }))
		} else if (sub === 'rm' && name) print(await call(`/api/routines/${name}`, { method: 'DELETE' }))
		else die('usage: routine list [--kind K] [--engine E] | show NAME | run NAME [--args JSON] | save NAME FILE [--title T] [--description D] [--engines E] [--kind K] [--when TEXT] [--takes TEXT] | suggest [--since 30d] [--min N] | stats [--since 30d] | rm NAME')
		break
	}
	case 'guide':
		// Written for the chat agent, which runs from the checkout. Everyone else has `toucan`.
		// Its note on how the chat panel runs the CLI only makes sense there.
		print(readFileSync(join(ROOT, 'AGENTS.md'), 'utf8').replace(/^In the chat panel you run it as .*\n\n?/m, '').replaceAll('node bin/toucan.mjs', 'toucan'))
		break
	case 'mcp':
		(await import('../lib/mcp.mjs')).serve()
		break
	case 'status': {
		const p = await control.probe(server)
		const c = control.readCfg()
		if (p.state === 'up') print({ running: true, url: p.url, version: p.health.version ?? null, pid: p.health.pid ?? null, startedByToucan: !!p.health.managed, data: p.health.data ?? c.data ?? null, headless: p.health.headless ?? null })
		else print({ running: false, state: p.state, url: p.url })
		break
	}
	case 'start': {
		const opts = {}
		const port = flag('port'), host = flag('host'), data = flag('data')
		if (typeof port === 'string') opts.port = Number(port)
		if (typeof host === 'string') opts.host = host
		if (typeof data === 'string') opts.data = resolve(data)
		if (flag('no-headless')) opts.headless = false
		else if (flag('headless')) opts.headless = true
		const takeOver = !!flag('take-over')
		try {
			const r = await control.start(opts, { takeOver })
			print(r.already ? `already running at ${r.url}${r.pending ? '. `toucan restart` applies the new options' : ''}` : `running at ${r.url}, canvases in ${r.health.data}. Log: ${control.LOG}`)
		} catch (e) {
			die(e.message)
		}
		break
	}
	case 'stop': {
		const r = await control.stop()
		print(r.stopped ? 'stopped' : r.why)
		if (!r.stopped && r.why !== 'not running') process.exitCode = 1
		break
	}
	case 'restart': {
		const r = await control.stop()
		if (!r.stopped && r.why !== 'not running') die(r.why)
		try {
			const s = await control.start()
			print(`running at ${s.url}, canvases in ${s.health.data}`)
		} catch (e) {
			die(e.message)
		}
		break
	}
	case 'doctor': {
		const { doctor, printChecks } = await import('../lib/onboard.mjs')
		const checks = await doctor()
		if (flag('json')) print(checks)
		else printChecks(checks)
		if (checks.some((c) => !c.ok && !c.optional)) process.exitCode = 1
		break
	}
	case 'setup': {
		if (server) die('setup is for a server on this machine, and TOUCAN_URL or --server names another. To connect agents to that one: toucan agents install')
		const { setup } = await import('../lib/onboard.mjs')
		const opts = { data: flag('data'), browser: !!flag('browser'), agents: !flag('no-agents'), open: !flag('no-open') }
		await setup(opts).catch((e) => die(e.message))
		break
	}
	case 'agents': {
		const agents = await import('../lib/agents.mjs')
		const mcp = !!flag('mcp'), force = !!flag('force')
		const [, sub, ...ids] = argv
		try {
			if (!sub) print(agents.status())
			else if (sub === 'install') {
				const rows = agents.install({ ids, mcp, force })
				if (!rows.length) print('no agents found here. Name one: toucan agents install claude|codex|gemini|pi|cursor|opencode|claude-desktop')
				for (const r of rows) {
					console.log(`${r.name}: ${r.did.join(', ') || 'nothing done'}`)
					for (const p of r.problems) console.error(`  ${p}`)
				}
				if (rows.some((r) => r.problems.length)) process.exitCode = 1
			} else if (sub === 'remove') {
				const rows = agents.remove({ ids })
				print(rows.length ? rows.map((r) => `${r.name}: removed ${r.did.join(', ')}`).join('\n') : 'nothing to remove')
			} else die('usage: agents [install [ID...] [--mcp] [--force] | remove [ID...]]')
		} catch (e) {
			die(e.message)
		}
		break
	}
	case 'update': {
		const { update } = await import('../lib/onboard.mjs')
		await update().catch((e) => die(e.message))
		break
	}
	case 'version':
	case '--version':
	case '-v':
		print(control.VERSION)
		break
	case 'help':
	case '--help':
	case '-h':
	default:
		{
			// The comment block at the top of this file, however long it grows.
			const lines = readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1)
			console.log(lines.slice(0, lines.findIndex((l) => !l.startsWith('//'))).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'))
		}
		if (cmd && !LOCAL.includes(cmd)) die(`unknown command ${cmd} (no toucan-${cmd} on PATH)`)
}
