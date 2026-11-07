// End to end check of what people install: pack the release tarball, install it the way install.sh does into a throwaway
// prefix and HOME, run `toucan setup`, and use it. It proves the tarball holds all it needs and nothing of the checkout's.
//   node scripts/install-check.mjs [TARBALL]   (default: runs `npm pack`, which builds the app)
import assert from 'node:assert/strict'
import { execFile, spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync } from 'node:fs'
import { createServer as createHttpServer } from 'node:http'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const base = realpathSync(mkdtempSync(join(tmpdir(), 'toucan-install-')))
const home = join(base, 'home')
const project = join(base, 'code', 'my-app')
mkdirSync(home)
mkdirSync(join(project, '.git'), { recursive: true })
const port = await new Promise((r) => {
	const s = createServer().listen(0, '127.0.0.1', () => (r(s.address().port), s.close()))
})
const ok = (msg) => console.log(`ok  ${msg}`)

let tarball = process.argv[2] && resolve(process.argv[2])
if (!tarball) {
	const r = spawnSync('npm', ['pack', '--json', '--pack-destination', base], { cwd: ROOT, encoding: 'utf8' })
	assert.equal(r.status, 0, r.stderr)
	// The pack step prints the build log first; the JSON starts a line on its own: an array up to npm 11, an object
	// keyed by package name from npm 12.
	const at = Math.max(r.stdout.lastIndexOf('\n[\n'), r.stdout.lastIndexOf('\n{\n')) + 1
	const packed = JSON.parse(r.stdout.slice(at))
	tarball = join(base, (Array.isArray(packed) ? packed : Object.values(packed)).at(-1).filename)
}
ok(`tarball: ${(statSync(tarball).size / 1e6).toFixed(1)} MB`)

const prefix = join(base, 'prefix')
const bin = join(prefix, 'bin')
mkdirSync(prefix)
const browsers = process.env.PLAYWRIGHT_BROWSERS_PATH
// Served over HTTP, as the release is, so install.sh's download path runs: npm 12 refuses to install from a URL
// itself (allow-remote=none), which a local-file install never shows.
const served = await new Promise((r) => {
	const s = createHttpServer((req, res) => { res.setHeader('content-type', 'application/octet-stream'); res.end(readFileSync(tarball)) })
	s.listen(0, '127.0.0.1', () => r(s))
})
const tarballUrl = `http://127.0.0.1:${served.address().port}/toucan.tgz`
const env = { PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`, HOME: home, TOUCAN_PORT: String(port), npm_config_prefix: prefix, TOUCAN_TARBALL: tarballUrl, ...(browsers && { PLAYWRIGHT_BROWSERS_PATH: browsers }) }
const run = promisify(execFile)
const toucan = (args, opts = {}) => run(join(bin, 'toucan'), args, { env, maxBuffer: 64 << 20, ...opts }).then((r) => r.stdout.trim())

let t0 = Date.now()
try {
	// install.sh, as curl | sh runs it: from nowhere in particular, with arguments for setup.
	const inst = await run('sh', [join(ROOT, 'install.sh'), '--no-open', '--no-agents'], { env, cwd: base, maxBuffer: 16 << 20 })
	console.log(inst.stdout.replace(/#token=\S+/, '#token=…').trim().split('\n').map((l) => `    ${l}`).join('\n'))
	ok(`install.sh and setup: ${((Date.now() - t0) / 1000).toFixed(0)}s`)

	const pkg = join(prefix, 'lib/node_modules/toucan')
	assert.ok(existsSync(join(pkg, 'dist/index.html')), 'the built app ships')
	assert.ok(existsSync(join(pkg, 'AGENTS.md')) && existsSync(join(pkg, 'skills/toucan/SKILL.md')) && existsSync(join(pkg, 'examples/welcome.tg.json')) && existsSync(join(pkg, 'routines')) && existsSync(join(pkg, 'templates/index.mjs')))
	assert.ok(!existsSync(join(pkg, 'website')) && !existsSync(join(pkg, 'scripts')) && !existsSync(join(pkg, 'app')), 'the checkout stays behind')
	const modules = join(pkg, 'node_modules')
	assert.ok(!existsSync(join(modules, 'tldraw')) && !existsSync(join(modules, 'shadcn')) && !existsSync(join(modules, 'vite')), 'build-time dependencies stay behind too')
	ok(`install is lean: ${readdirSync(modules).length} top-level modules`)

	const status = JSON.parse(await toucan(['status']))
	assert.equal(status.running, true)
	assert.ok(status.data.startsWith(home), `canvases in the home directory, not the install: ${status.data}`)
	assert.ok(!status.data.includes('node_modules'))
	const canvases = JSON.parse(await toucan(['canvases']))
	assert.deepEqual(canvases.map((c) => c.name), ['welcome'], 'setup made the first canvas')
	const cfg = JSON.parse((await run('cat', [join(home, '.config/toucan/server.json')])).stdout)
	const page = await fetch(`${cfg.url}/`)
	assert.match(await page.text(), /<div id="root"|<!doctype html/i, 'the app is served')
	ok('server runs from the install, canvases in the data home, a welcome canvas waits')

	const made = JSON.parse(await toucan(['init', '--template', 'flowchart'], { cwd: project }))
	assert.equal(made.canvas, 'my-app')

	// The MCP server, over real stdio, as a harness would start it.
	const mcp = spawn(join(bin, 'toucan'), ['mcp'], { env, cwd: project, stdio: ['pipe', 'pipe', 'inherit'] })
	const lines = createInterface({ input: mcp.stdout })[Symbol.asyncIterator]()
	let id = 0
	const ask = async (method, params) => {
		mcp.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }) + '\n')
		return JSON.parse((await lines.next()).value)
	}
	assert.ok((await ask('server/discover', {})).result.supportedVersions.length)
	const init = await ask('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'check', version: '1' } })
	assert.equal(init.result.serverInfo.name, 'toucan')
	const text = async (name, args) => {
		const r = (await ask('tools/call', { name, arguments: args })).result
		assert.ok(!r.isError, `${name}: ${r.content[0].text}`)
		return r.content[0]
	}
	assert.match((await text('toucan_canvases', {})).text, /my-app/)
	assert.equal(JSON.parse((await text('toucan_project_canvas', {})).text).canvas, 'my-app', "the harness's directory finds the project's canvas")
	assert.match((await text('toucan_templates', {})).text, /flowchart/)
	ok('mcp over stdio: discover, initialize, tools')

	// With a browser here, the whole path: an agent builds on a canvas nobody has open, using whatever Chromium the machine has.
	const doc = await toucan(['doctor']).catch((e) => e.stdout)
	if (/✓ headless/.test(doc)) {
		const id = (await text('toucan_exec', { code: 'toucan.node("hello", { x: 0, y: 0, text: "Hello" }); toucan.node("there", { x: 300, y: 0, text: "There" }); toucan.edge("hello", "there"); return toucan.get("hello").id', label: 'install check' })).text
		assert.match(id, /shape:/)
		assert.match((await text('toucan_summary', {})).text, /Hello/)
		assert.match((await text('toucan_import', { content: 'graph LR\n  hello --> added[Added]\n' })).text, /created/)
		const shot = await text('toucan_screenshot', {})
		assert.equal(shot.type, 'image')
		assert.ok(shot.data.length > 1000)
		// An edit made just before a stop survives it.
		await text('toucan_exec', { code: 'toucan.node("last", { x: 0, y: 300, text: "Last second" })' })
		assert.match(await toucan(['stop']), /stopped/)
		assert.match((await text('toucan_summary', {})).text, /Last second/, 'saved on the way out')
		ok(`headless: an agent drew on a canvas with no tab open (${doc.match(/headless\s+(.*?),/)[1]})`)
	} else console.log(`--  skipped headless: ${doc.match(/headless.*/)[0]}`)
	mcp.stdin.end()
	await new Promise((r) => mcp.on('exit', r))

	// An update over this install, from the same tarball.
	assert.match(await toucan(['update']), /toucan \d+\.\d+\.\d+/)
	assert.equal(JSON.parse(await toucan(['status'])).running, true, 'the server comes back')
	assert.deepEqual(JSON.parse(await toucan(['canvases'])).map((c) => c.name).sort(), ['my-app', 'welcome'], 'canvases survive an update')
	ok('update keeps canvases and restarts the server')

	assert.match(await toucan(['stop']), /stopped/)
} finally {
	served.close()
	await toucan(['stop']).catch(() => {})
	rmSync(base, { recursive: true, force: true })
}
