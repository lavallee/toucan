#!/usr/bin/env node
// toucan CLI — how agents (Codex in the chat panel, or Claude Code / Codex / pi in a
// terminal) read and change a canvas that is open in a browser tab (or, on a server started
// with --headless, in the server's own headless page when no tab is open).
//
//   toucan [--canvas NAME] <command>
//     url                         sign-in link for the browser (opens the index of canvases)
//     canvases                    list canvases: title, shapes, scripts, open tabs
//     new NAME [--engine tldraw|excalidraw] [--from CANVAS|FILE] [--title T] [--description D] [--canvas-format story|ideas|system]
//                                 make a canvas; --from copies another canvas (or a graph file) via TG
//     graph [--format tg|jsoncanvas|mermaid|dot|excalidraw] [OUT]   export (no tab needed)
//     import FILE|- [--format F] [--move] [--prune] [--propose] [--label T]   keyed upsert of a graph file into the open canvas
//                                 (--propose: what it adds arrives dashed, as a proposal)
//     meta [--title T] [--description D] [--canvas-format story|ideas|system|none]   retitle, describe or set --canvas's format
//     archive                     move --canvas aside to canvases/.archive/ (no tabs may have it open)
//     summary [--within KEY]      compact JSON of shapes on the page
//     exec -e CODE | FILE | - [--label TEXT]   run JS in the live editor; `return` a JSON value (--label names it in the history)
//     screenshot [OUT.png]        PNG of the page (or --keys a,b; --max px, default 1800)
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
//     routine list | show NAME | run NAME [--args JSON] | save NAME FILE [--title T] [--description D] [--engines E] | rm NAME
//                                 chores banked once and run on any canvas (no --canvas needed to list, show, save or rm)
//
//   Any other command runs `toucan-<command>` from PATH with the same arguments and
//   TOUCAN_CANVAS set, so extensions live in their own repos (see README, "Extending").

import { readFileSync, writeFileSync, existsSync, statSync, mkdirSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { FORMATS } from '../lib/tg.mjs'
import { connect } from '../lib/client.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const argv = process.argv.slice(2)
const flag = (name, fallback) => {
	const i = argv.indexOf(`--${name}`)
	if (i < 0) return fallback
	const v = argv[i + 1]
	argv.splice(i, v === undefined || v.startsWith('--') ? 1 : 2)
	return v === undefined || v.startsWith('--') ? true : v
}
const explicitCanvas = argv.includes('--canvas') || !!process.env.TOUCAN_CANVAS
const canvas = flag('canvas', process.env.TOUCAN_CANVAS)
const server = flag('server', process.env.TOUCAN_URL)
const [cmd, ...rest] = argv
// Positional arguments after the command, once a case has consumed its flags.
const positional = () => argv.slice(1)

function die(msg) {
	console.error(`toucan: ${msg}`)
	process.exit(1)
}

const BUILTIN = ['url', 'canvases', 'summary', 'exec', 'screenshot', 'script', 'new', 'meta', 'graph', 'import', 'archive', 'notes', 'selection', 'proposals', 'log', 'versions', 'routine', 'threads', 'files']
let client
if (cmd && !BUILTIN.includes(cmd)) {
	// An extension command: `toucan foo …` runs `toucan-foo …` from PATH.
	const r = spawnSync(`toucan-${cmd}`, rest, { stdio: 'inherit', env: { ...process.env, ...(canvas && { TOUCAN_CANVAS: canvas }), ...(server && { TOUCAN_URL: server }) } })
	if (r.error?.code !== 'ENOENT') process.exit(r.error ? (console.error(`toucan: ${r.error.message}`), 1) : (r.status ?? 1))
} else if (cmd) {
	try {
		client = connect({ canvas, server })
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

const print = (v) => console.log(typeof v === 'string' ? v : JSON.stringify(v, null, 2))

switch (cmd) {
	case 'url': {
		print(`${client.url(explicitCanvas ? canvas : null)}#token=${cfg.token}`)
		break
	}
	case 'canvases':
		print((await call('/api/canvases')).canvases.map(({ thumb, ...c }) => c))
		break
	case 'summary': {
		const within = flag('within')
		print(await exec(`return toucan.summary(${JSON.stringify({ within: within || undefined })})`))
		break
	}
	case 'exec': {
		const label = flag('label')
		const args = positional()
		const i = args.findIndex((a) => a === '-e' || a === '--eval')
		const src = i >= 0 ? args[i + 1] : args[0] === '-' || !args[0] ? readFileSync(0, 'utf8') : readFileSync(args[0], 'utf8')
		if (src === undefined) die('usage: exec -e CODE | FILE | - [--label TEXT]')
		print(await exec(src, 120000, typeof label === 'string' ? label : undefined))
		break
	}
	case 'screenshot': {
		const keys = flag('keys')
		const max = Number(flag('max', 1800))
		const out = positional()[0] ?? (mkdirSync(join(ROOT, '.toucan'), { recursive: true }), join(ROOT, '.toucan', `${canvas}.png`))
		const b64 = await exec(`return toucan.screenshot(${JSON.stringify({ keys: keys ? String(keys).split(',') : null, max })})`)
		if (!b64) die('canvas is empty')
		writeFileSync(out, Buffer.from(b64, 'base64'))
		print(out)
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
		const title = flag('title'), description = flag('description'), engine = flag('engine', 'tldraw'), from = flag('from'), canvasFormat = flag('canvas-format')
		const [name] = positional()
		if (!name) die('usage: new NAME [--engine tldraw|excalidraw] [--from CANVAS|FILE] [--title T] [--description D]')
		const seed = from && existsSync(from) && statSync(from).isFile() ? { graph: readGraph(from, flag('format')) } : from ? { from } : {}
		await call('/api/canvases', { method: 'POST', body: JSON.stringify({ name, title, description, engine, ...seed, ...(canvasFormat && { format: canvasFormat }) }) })
		print(`made ${name} — open ${client.url(name)}`)
		break
	}
	case 'meta': {
		const title = flag('title'), description = flag('description'), canvasFormat = flag('canvas-format')
		print(await call(cpath(`/meta`), { method: 'PATCH', body: JSON.stringify({ title, description, ...(canvasFormat && { format: canvasFormat === 'none' ? '' : canvasFormat }) }) }))
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
		print(await exec(`return await toucan.applyGraph(${JSON.stringify(tg)}, ${JSON.stringify(opts)})`, 120000, label))
		break
	}
	case 'proposals': {
		const [, sub, ...keys] = argv
		if (!sub) print(await exec('return toucan.proposals()'))
		else if (sub === 'accept' || sub === 'reject') print(await exec(`return toucan.${sub}(...${JSON.stringify(keys)})`))
		else die('usage: proposals [accept|reject [KEY...]]   (no keys: all of them)')
		break
	}
	case 'selection':
		print(await exec('return toucan.selection()'))
		break
	case 'notes': {
		const all = argv.includes('--all') && (argv.splice(argv.indexOf('--all'), 1), true)
		const reply = flag('reply')
		const [, sub, key] = argv
		const tldrawOnly = `if (toucan.engine !== 'tldraw') throw new Error('notes are a tldraw convention; this canvas runs ' + toucan.engine)\n`
		if (sub === 'resolve' && key && typeof reply === 'string') print(await exec(`${tldrawOnly}return toucan.resolveNote(${JSON.stringify(key)}, ${JSON.stringify(reply)})`))
		else if (!sub) print(await exec(`${tldrawOnly}return toucan.notes(${JSON.stringify({ all })})`))
		else die('usage: notes [--all] | notes resolve KEY --reply TEXT')
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
		const [, sub, name, file] = argv
		if (sub === 'list' || !sub) print((await call('/api/routines')).routines)
		else if (sub === 'show' && name) print((await call(`/api/routines/${name}`)).code)
		else if (sub === 'run' && name) {
			const r = await call(cpath(`/routines/${name}/run`), { method: 'POST', body: JSON.stringify({ args: typeof args === 'string' ? JSON.parse(args) : undefined }) })
			if (!r.ok) die(r.error)
			print(r.result ?? 'done')
		} else if (sub === 'save' && name && file) {
			const code = readFileSync(file === '-' ? 0 : file, 'utf8')
			print(await call(`/api/routines/${name}`, { method: 'PUT', body: JSON.stringify({ code, title, description, engines: typeof engines === 'string' ? engines.split(/[,\s]+/) : undefined }) }))
		} else if (sub === 'rm' && name) print(await call(`/api/routines/${name}`, { method: 'DELETE' }))
		else die('usage: routine list | show NAME | run NAME [--args JSON] | save NAME FILE [--title T] [--description D] [--engines E] | rm NAME')
		break
	}
	default:
		{
			// The comment block at the top of this file, however long it grows.
			const lines = readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1)
			console.log(lines.slice(0, lines.findIndex((l) => !l.startsWith('//'))).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'))
		}
		if (cmd) die(`unknown command ${cmd} (no toucan-${cmd} on PATH)`)
}
