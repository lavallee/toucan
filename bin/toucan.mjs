#!/usr/bin/env node
// toucan CLI — how agents (Codex in the chat panel, or Claude Code / Codex / pi in a
// terminal) read and change a canvas that is open in a browser tab.
//
//   toucan [--canvas NAME] <command>
//     url                         sign-in link for the browser (opens the index of canvases)
//     canvases                    list canvases: title, shapes, scripts, open tabs
//     new NAME [--engine tldraw|excalidraw] [--from CANVAS|FILE] [--title T] [--description D]
//                                 make a canvas; --from copies another canvas (or a graph file) via TG
//     graph [--format tg|jsoncanvas|mermaid|dot|excalidraw] [OUT]   export (no tab needed)
//     import FILE [--format F] [--move] [--prune]   keyed upsert of a graph file into the open canvas
//     meta [--title T] [--description D]        retitle/describe --canvas
//     archive                     move --canvas aside to canvases/.archive/ (no tabs may have it open)
//     summary [--within KEY]      compact JSON of shapes on the page
//     exec -e CODE | FILE | -     run JS in the live editor; `return` a JSON value
//     screenshot [OUT.png]        PNG of the page (or --keys a,b; --max px, default 1800)
//     script list | put NAME FILE | rm NAME     canvas scripts (persistent behaviour)
//
//   Any other command runs `toucan-<command>` from PATH with the same arguments and
//   TOUCAN_CANVAS set, so extensions live in their own repos (see README, "Extending").

import { readFileSync, writeFileSync, existsSync, statSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
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

const BUILTIN = ['url', 'canvases', 'summary', 'exec', 'screenshot', 'script', 'new', 'meta', 'graph', 'import', 'archive']
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
		const i = rest.findIndex((a) => a === '-e' || a === '--eval')
		const src = i >= 0 ? rest[i + 1] : rest[0] === '-' || !rest[0] ? readFileSync(0, 'utf8') : readFileSync(rest[0], 'utf8')
		if (src === undefined) die('usage: exec -e CODE | FILE | -')
		print(await exec(src, 120000))
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
		const title = flag('title'), description = flag('description'), engine = flag('engine', 'tldraw'), from = flag('from')
		const [name] = positional()
		if (!name) die('usage: new NAME [--engine tldraw|excalidraw] [--from CANVAS|FILE] [--title T] [--description D]')
		const seed = from && existsSync(from) && statSync(from).isFile() ? { graph: readGraph(from, flag('format')) } : from ? { from } : {}
		await call('/api/canvases', { method: 'POST', body: JSON.stringify({ name, title, description, engine, ...seed }) })
		print(`made ${name} — open ${client.url(name)}`)
		break
	}
	case 'meta': {
		const title = flag('title'), description = flag('description')
		print(await call(cpath(`/meta`), { method: 'PATCH', body: JSON.stringify({ title, description }) }))
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
		if (!file) die('usage: import FILE [--format tg|jsoncanvas|mermaid|excalidraw] [--move] [--prune]')
		const tg = readGraph(file, flag('format'))
		if (tg.warnings?.length) console.error(`toucan: ${tg.warnings.length} line(s) not understood:\n  ${tg.warnings.join('\n  ')}`)
		print(await exec(`return await toucan.applyGraph(${JSON.stringify(tg)}, ${JSON.stringify({ move: !!flag('move'), prune: !!flag('prune') })})`, 120000))
		break
	}
	case 'archive':
		print(await call(cpath(`/archive`), { method: 'POST' }))
		break
	default:
		console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 20).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'))
		if (cmd) die(`unknown command ${cmd} (no toucan-${cmd} on PATH)`)
}
