// `toucan setup` and `toucan doctor`: get a machine ready, and say plainly what isn't.

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, realpathSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { delimiter, dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { launchBrowser } from '../server/headless.mjs'
import * as agents from './agents.mjs'
import { connect as connect_ } from './client.mjs'
import { ROOT, VERSION, probe, readCfg, runByHand, start } from './control.mjs'
import { openInBrowser } from './open.mjs'
import { readJson, resolveData } from './paths.mjs'

export const isCheckout = () => existsSync(join(ROOT, '.git'))

function codexState() {
	if (!agents.onPath('codex')) return { ok: false, note: 'not installed. The canvas and CLI work without it; only the built-in chat panel needs it (https://github.com/openai/codex)' }
	const r = spawnSync('codex', ['login', 'status'], { encoding: 'utf8', timeout: 10000, shell: process.platform === 'win32' })
	return r.status === 0 ? { ok: true, note: 'installed and signed in, so the chat panel works' } : { ok: false, note: 'installed but not signed in: run `codex login` for the chat panel' }
}

export async function browserState() {
	try {
		const { browser, how } = await launchBrowser(await import('playwright-core'))
		await browser.close()
		return { ok: true, note: `${how}, so agents can work with no tab open` }
	} catch (e) {
		return { ok: false, note: `${e.message.split('\n')[0]} Without one, agents need a tab open on the canvas` }
	}
}

/** A list of checks, each { name, ok, note }; `ok: false` with `optional` is a limit rather than a fault. */
export async function doctor() {
	const major = Number(process.versions.node.split('.')[0])
	const out = []
	const add = (name, ok, note, optional) => out.push({ name, ok, note, ...(optional && { optional }) })
	add('node', major >= 22, `${process.versions.node}${major >= 22 ? '' : ' (toucan needs 22 or newer)'}`)
	add('toucan', true, `${VERSION} in ${ROOT}`)
	add('app', existsSync(join(ROOT, 'dist/index.html')), existsSync(join(ROOT, 'dist/index.html')) ? 'built' : 'not built: run `npm install && npm run build` in the checkout')
	const p = await probe()
	const cfg = readCfg()
	if (p.state === 'up') {
		const v = p.health.version
		add('server', !v || v === VERSION, `running at ${p.url}${p.health.pid ? `, pid ${p.health.pid}` : ''}${p.health.managed ? ', started by toucan' : ''}${v && v !== VERSION ? `, but it is version ${v}: ${p.health.managed ? 'run `toucan restart`' : 'restart it'}` : ''}`)
	} else if (p.state === 'down') add('server', true, `not running; ${runByHand(cfg) ? 'start it the way you usually do (or `toucan start --take-over` to have toucan run it)' : 'it starts when a command needs it'}`)
	else if (p.state === 'blocked') add('server', false, `can't reach ${p.url} (${p.code}): a sandbox is blocking local network, so use the toucan_* MCP tools instead of this CLI`)
	else if (p.state === 'slow') add('server', true, `at ${p.url}, but it's slow to answer`)
	else add('server', false, `something else answers at ${p.url}. Choose another port: toucan start --port N`)
	const data = p.health?.data ? { dir: p.health.data, why: 'in use by the server' } : !runByHand(cfg) && cfg.start?.data ? { dir: cfg.start.data, why: 'chosen with --data' } : resolveData({ root: ROOT })
	const count = Object.keys(readJson(join(data.dir, '_index.json'))).length
	add('canvases', true, `${count} in ${data.dir} (${data.why})`)
	// Inside a sandbox, trying a browser says nothing about the machine.
	if (p.state === 'blocked') return out
	if (p.health?.headless === false) add('headless', false, 'off on this server: agents need a tab open on the canvas', true)
	else {
		const b = await browserState()
		add('headless', b.ok, b.note, true)
	}
	const c = codexState()
	add('chat', c.ok, c.note, true)
	for (const a of agents.status().filter((a) => a.present)) {
		const skill = { current: 'skill installed', outdated: 'skill is out of date: run `toucan agents install`', none: 'not connected: run `toucan agents install`', foreign: 'has another skill named toucan' }[a.skill]
		add(`agent: ${a.name}`, a.skill === 'current' || (a.skill === null && a.mcp), skill ?? (a.mcp ? 'connected over MCP' : 'not connected: run `toucan agents install`'), true)
	}
	return out
}

export const printChecks = (checks) => {
	for (const c of checks) console.log(`${c.ok ? '✓' : c.optional ? '–' : '✗'} ${c.name.padEnd(20)} ${c.note}`)
}

/** Put `toucan` on PATH for a person running from a checkout. An npm install already has. */
function linkCli() {
	if (agents.onPath('toucan') || process.platform === 'win32') return null
	const dir = join(homedir(), '.local/bin')
	const link = join(dir, 'toucan')
	mkdirSync(dir, { recursive: true })
	try {
		symlinkSync(realpathSync(fileURLToPath(new URL('../bin/toucan.mjs', import.meta.url))), link)
	} catch (e) {
		if (e.code !== 'EEXIST') throw e
		return `${link} already exists and isn't this toucan; it's yours to replace or remove`
	}
	return `linked ${link}${(process.env.PATH ?? '').split(delimiter).includes(dir) ? '' : `. Add ${dir} to your PATH`}`
}

export function installBrowser() {
	const cli = join(dirname(fileURLToPath(import.meta.resolve('playwright-core'))), 'cli.js')
	const r = spawnSync(process.execPath, [cli, 'install', 'chromium'], { stdio: 'inherit' })
	if (r.status !== 0) throw new Error('installing Chromium failed')
}

const RELEASE = () => process.env.TOUCAN_TARBALL ?? 'https://github.com/lavallee/toucan/releases/latest/download/toucan.tgz'

/** npm 12 refuses to install from a URL by default (allow-remote=none), so a release URL is downloaded to a temporary
 * file first; npm installs a local file under any setting. A local path passes through. */
async function localTarball(ref) {
	if (!/^https?:\/\//.test(ref)) return { path: ref, done: () => {} }
	const res = await fetch(ref)
	if (!res.ok) throw new Error(`couldn't download ${ref}: HTTP ${res.status}`)
	const dir = mkdtempSync(join(tmpdir(), 'toucan-update-'))
	const path = join(dir, 'toucan.tgz')
	writeFileSync(path, Buffer.from(await res.arrayBuffer()))
	return { path, done: () => rmSync(dir, { recursive: true, force: true }) }
}

/** Get this machine ready. Asks nothing, so an agent can run it; says everything it did and how to undo it. */
export async function setup({ data, browser, agents: connect, open }) {
	if (Number(process.versions.node.split('.')[0]) < 22) throw new Error(`toucan needs Node 22 or newer; this is ${process.versions.node}`)
	if (!existsSync(join(ROOT, 'dist/index.html'))) {
		if (!isCheckout()) throw new Error('this install has no built app; reinstall it')
		console.log('Building the app (once)…')
		const r = spawnSync('npm', ['run', 'build'], { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' })
		if (r.status !== 0) throw new Error('the build failed. Run `npm install`, then try again')
	}
	const linked = linkCli()
	if (linked) console.log(`✓ ${linked}`)

	if (browser) installBrowser()

	const running = await start(typeof data === 'string' ? { data: resolve(data) } : {})
	if (running.pending && running.health.data !== resolve(data)) console.log(`! The server is still using ${running.health.data}. \`toucan restart\` moves it to ${resolve(data)}, leaving what's there where it is.`)
	console.log(`✓ server at ${running.url}, canvases in ${running.health.data ?? 'its data directory'}`)

	const client = connect_({})
	const existing = (await client.call('/api/canvases')).canvases
	if (!existing.length) {
		await client.call('/api/canvases', { method: 'POST', body: JSON.stringify({ name: 'welcome', title: 'Welcome to toucan', description: 'A first canvas: what toucan does, and what to ask your agent.', graph: JSON.parse(readFileSync(join(ROOT, 'examples/welcome.tg.json'), 'utf8')) }) })
		console.log('✓ made a first canvas, "welcome"')
	}

	if (connect) {
		const rows = agents.install()
		for (const r of rows) {
			if (r.did.length) console.log(`✓ ${r.name}: ${r.did.join(', ')}`)
			for (const p of r.problems) console.log(`! ${r.name}: ${p}`)
		}
		if (rows.length) console.log('  Undo any of this with `toucan agents remove [ID]`.')
		else console.log('– no agents found. After installing one: `toucan agents install`')
	}

	const b = browser ? { ok: true } : await browserState()
	if (!b.ok) console.log(`– headless: no browser found, so agents need a tab open on the canvas. Install Chrome or Chromium, or run \`toucan setup --browser\` (about 150 MB).`)

	const target = existing.length ? null : 'welcome'
	const url = client.url(target)
	if (open && (await openInBrowser(`${url}#token=${client.cfg.token}`))) console.log(`✓ opened ${url}`)
	else console.log(`\nOpen this link to sign in; it holds your access token, so don't share it:\n  ${url}#token=${client.cfg.token}`)
	console.log(`
Next, from any project, ask your agent something like:
  "Use toucan to draw how this repo fits together, and open it for me."
Or by hand: cd your-project && toucan init --open
\`toucan doctor\` checks the install. \`toucan --help\` has the rest.`)
}

/** Install the latest release over this one, then bring along what depends on it. */
export async function update() {
	if (isCheckout()) throw new Error(`this is a git checkout. Update it with: cd ${ROOT} && git pull && npm install && npm run build && toucan restart`)
	// A global npm install lives at <prefix>/lib/node_modules/toucan on Unix and <prefix>/node_modules/toucan on Windows.
	const unix = process.platform !== 'win32'
	if (unix && !ROOT.endsWith(join('lib', 'node_modules', 'toucan'))) throw new Error(`toucan in ${ROOT} wasn't installed globally, so update it however you installed it`)
	const prefix = unix ? resolve(ROOT, '../../..') : resolve(ROOT, '../..')
	const pkg = await localTarball(RELEASE())
	const r = spawnSync('npm', ['install', '-g', '--prefix', prefix, '--no-audit', '--no-fund', pkg.path], { stdio: 'inherit', shell: process.platform === 'win32' })
	pkg.done()
	if (r.status !== 0) throw new Error('the update failed; the installed version is unchanged')
	// This process is still the old version: the new one does the rest.
	const after = spawnSync(process.execPath, [join(ROOT, 'bin/toucan.mjs'), '--version'], { encoding: 'utf8' }).stdout.trim()
	spawnSync(process.execPath, ['--input-type=module', '-e', `const a = await import(${JSON.stringify(pathToFileURL(join(ROOT, 'lib/agents.mjs')).href)}); for (const r of a.refresh()) console.log(r.name + ': ' + r.did.join(', '))`], { stdio: 'inherit' })
	const was = await probe()
	if (was.state === 'up' && was.health.managed) spawnSync(process.execPath, [join(ROOT, 'bin/toucan.mjs'), 'restart'], { stdio: 'inherit' })
	else if (was.state === 'up') console.log('Restart your server to run the new version.')
	console.log(`toucan ${after}`)
}
