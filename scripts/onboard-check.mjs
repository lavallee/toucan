// Checks for getting started: where canvases live, project links, connecting agents, the MCP server, and a server
// that starts itself. Runs against a throwaway HOME and port, so it never touches ~/.config/toucan or real canvases.
//   node scripts/onboard-check.mjs
import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const BIN = join(ROOT, 'bin/toucan.mjs')
const base = realpathSync(mkdtempSync(join(tmpdir(), 'toucan-onboard-')))
const home = join(base, 'home')
const shims = join(base, 'bin')
mkdirSync(home, { recursive: true })
mkdirSync(shims)
const port = await new Promise((r) => {
	const s = createServer().listen(0, '127.0.0.1', () => (r(s.address().port), s.close()))
})
// Modules read HOME when they load, so set it before importing them.
process.env.HOME = home
process.env.USERPROFILE = home
process.env.PATH = shims // only the agents this check pretends to have
process.env.TOUCAN_PORT = String(port)
for (const k of ['TOUCAN_URL', 'TOUCAN_CANVAS', 'TOUCAN_DATA', 'TOUCAN_TOKEN', 'XDG_DATA_HOME', 'DISPLAY', 'WAYLAND_DISPLAY']) delete process.env[k]

const { dataHome, resolveData } = await import('../lib/paths.mjs')
const projects = await import('../lib/projects.mjs')
const agents = await import('../lib/agents.mjs')
const { handle } = await import('../lib/mcp.mjs')
const ok = (msg) => console.log(`ok  ${msg}`)
const run = promisify(execFile)
const toucan = (args, opts = {}) => run(process.execPath, [BIN, ...args], { maxBuffer: 16 << 20, ...opts }).then((r) => r.stdout.trim())
const failure = (args, opts) => toucan(args, opts).then(() => assert.fail(`${args.join(' ')} should fail`), (e) => e.stderr)

try {
	// ---- where canvases live
	assert.equal(dataHome({ platform: 'linux', env: {}, home: '/h' }), '/h/.local/share/toucan')
	assert.equal(dataHome({ platform: 'linux', env: { XDG_DATA_HOME: '/x' }, home: '/h' }), '/x/toucan')
	assert.equal(dataHome({ platform: 'darwin', env: {}, home: '/h' }), '/h/Library/Application Support/toucan')
	assert.match(dataHome({ platform: 'win32', env: { LOCALAPPDATA: 'C:/L' }, home: '/h' }), /C:.L.toucan/)
	const co = join(base, 'checkout')
	mkdirSync(join(co, 'canvases'), { recursive: true })
	const at = (o) => resolveData({ root: co, env: {}, platform: 'linux', home: '/h', ...o })
	assert.equal(at({}).dir, '/h/.local/share/toucan/canvases', 'an empty canvases/ in a checkout is not a reason to use it')
	writeFileSync(join(co, 'canvases/_index.json'), '{}')
	assert.equal(at({}).dir, join(co, 'canvases'), 'a checkout with canvases keeps them')
	assert.equal(at({ env: { TOUCAN_DATA: '/env' } }).dir, '/env')
	assert.equal(at({ flag: '/flag', env: { TOUCAN_DATA: '/env' } }).dir, '/flag')
	ok('data directory: --data, TOUCAN_DATA, existing checkout, then the platform default')

	// ---- project links
	const repo = join(base, 'My Shop!')
	mkdirSync(join(repo, '.git'), { recursive: true })
	mkdirSync(join(repo, 'src/deep'), { recursive: true })
	assert.equal(projects.projectRoot(join(repo, 'src/deep')), repo)
	assert.equal(projects.slug(repo), 'my-shop')
	assert.equal(projects.slug('/x/---'), 'canvas')
	assert.equal(projects.findProject(join(repo, 'src')), null)
	assert.deepEqual(projects.chooseCanvas({ root: repo, existing: [] }), { canvas: 'my-shop', create: true })
	assert.deepEqual(projects.chooseCanvas({ root: repo, existing: ['my-shop', 'my-shop-2'] }), { canvas: 'my-shop-3', create: true }, "someone else's canvas of that name isn't taken over")
	projects.linkProject(repo, 'my-shop')
	assert.deepEqual(projects.findProject(join(repo, 'src/deep')), { root: repo, canvas: 'my-shop' })
	assert.deepEqual(projects.chooseCanvas({ root: repo, existing: ['my-shop'] }), { canvas: 'my-shop', create: false }, 'found again')
	assert.deepEqual(projects.chooseCanvas({ root: repo, existing: [] }), { canvas: 'my-shop', create: true }, 'a linked canvas that was archived is made again')
	assert.equal(projects.tooGeneral(home), true)
	ok('project links: nearest root, one canvas each, nothing written to the repository')
	assert.ok(!existsSync(join(repo, '.toucan')))

	// ---- connecting agents
	const shim = (name) => {
		writeFileSync(join(shims, name), `#!/bin/sh\necho "$@" >> "${join(base, `${name}.calls`)}"\n`)
		chmodSync(join(shims, name), 0o755)
	}
	const calls = (name) => (existsSync(join(base, `${name}.calls`)) ? readFileSync(join(base, `${name}.calls`), 'utf8') : '')
	assert.deepEqual(agents.install({ home }), [], 'no agents here, nothing done')
	mkdirSync(join(home, '.claude'))
	shim('codex')
	shim('claude')
	mkdirSync(join(home, '.cursor'))
	writeFileSync(join(home, '.cursor/mcp.json'), JSON.stringify({ mcpServers: { other: { command: 'x' } }, keep: 1 }))
	mkdirSync(join(home, '.config/opencode'), { recursive: true })
	writeFileSync(join(home, '.config/opencode/opencode.json'), '{ // comments\n "a": 1 }')
	mkdirSync(join(home, '.gemini/skills/toucan'), { recursive: true })
	writeFileSync(join(home, '.gemini/skills/toucan/SKILL.md'), 'mine')
	const rows = Object.fromEntries(agents.install({ home }).map((r) => [r.id, r]))
	assert.ok(existsSync(join(home, '.claude/skills/toucan/SKILL.md')), 'claude gets the skill')
	assert.ok(existsSync(join(home, '.agents/skills/toucan/SKILL.md')), 'codex gets the skill')
	assert.match(calls('codex'), /mcp add toucan -- .*mcp/, "codex also gets MCP: its sandbox blocks the CLI's local network")
	assert.equal(calls('claude'), '', 'claude does not get MCP unless asked: the skill and CLI are enough')
	assert.equal(readFileSync(join(home, '.gemini/skills/toucan/SKILL.md'), 'utf8'), 'mine', "a skill toucan didn't install is left alone")
	assert.match(rows.gemini.problems[0], /left alone/)
	assert.equal(JSON.parse(readFileSync(join(home, '.cursor/mcp.json'), 'utf8')).mcpServers.toucan, undefined, 'cursor has no MCP without --mcp')
	assert.equal(agents.status({ home }).find((a) => a.id === 'claude').skill, 'current')

	agents.install({ ids: ['cursor', 'claude'], mcp: true, home })
	const cursor = JSON.parse(readFileSync(join(home, '.cursor/mcp.json'), 'utf8'))
	assert.equal(cursor.keep, 1)
	assert.equal(cursor.mcpServers.other.command, 'x', 'other MCP servers stay')
	assert.deepEqual(cursor.mcpServers.toucan.args.at(-1), 'mcp')
	assert.ok(cursor.mcpServers.toucan.command.startsWith('/') || /^[A-Z]:/.test(cursor.mcpServers.toucan.command), 'a GUI app gets an absolute path')
	assert.ok(existsSync(join(home, '.cursor/mcp.json.before-toucan')), 'a backup')
	assert.match(calls('claude'), /mcp add -s user toucan -- /)
	const open = agents.install({ ids: ['opencode'], mcp: true, home })[0]
	writeFileSync(join(home, '.cursor/mine.json'), JSON.stringify({ mcpServers: { toucan: { command: 'my-own-toucan-thing' } } }))
	symlinkSync(join(home, '.cursor/mine.json'), join(home, '.cursor/linked.json'))
	assert.match(open.problems[0], /isn't plain JSON/, 'a config it cannot parse is reported, not rewritten')
	assert.match(readFileSync(join(home, '.config/opencode/opencode.json'), 'utf8'), /comments/)
	writeFileSync(join(home, '.config/opencode/opencode.json'), '{"a":1}')
	agents.install({ ids: ['opencode'], mcp: true, home })
	assert.equal(JSON.parse(readFileSync(join(home, '.config/opencode/opencode.json'), 'utf8')).mcp.toucan.type, 'local')
	assert.throws(() => agents.install({ ids: ['nope'], home }), /unknown agent/)
	// A server of the same name that isn't ours, in a config kept in a dotfiles repository.
	const realCursor = readFileSync(join(home, '.cursor/mcp.json'), 'utf8')
	rmSync(join(home, '.cursor/mcp.json'))
	rmSync(join(home, '.cursor/mcp.json.before-toucan'))
	symlinkSync(join(home, '.cursor/mine.json'), join(home, '.cursor/mcp.json'))
	assert.match(agents.install({ ids: ['cursor'], mcp: true, home })[0].problems[0], /isn't this one/, "another server named toucan isn't replaced")
	agents.remove({ ids: ['cursor'], home })
	assert.equal(JSON.parse(readFileSync(join(home, '.cursor/mine.json'), 'utf8')).mcpServers.toucan.command, 'my-own-toucan-thing', 'or removed')
	agents.install({ ids: ['cursor'], mcp: true, force: true, home })
	assert.ok(lstatSync(join(home, '.cursor/mcp.json')).isSymbolicLink(), 'a symlinked config stays a symlink')
	assert.equal(JSON.parse(readFileSync(join(home, '.cursor/mine.json'), 'utf8')).mcpServers.toucan.args.at(-1), 'mcp', 'and its target is what changes')
	assert.ok(!lstatSync(join(home, '.cursor/mcp.json.before-toucan')).isSymbolicLink(), 'the backup is a real copy')
	rmSync(join(home, '.cursor/mcp.json'))
	writeFileSync(join(home, '.cursor/mcp.json'), realCursor)
	// Refreshing after an update adds nothing a person took away.
	const before = calls('codex').length
	writeFileSync(join(home, '.agents/skills/toucan/.installed-by-toucan'), '0.0.1\n')
	assert.deepEqual(agents.refresh({ home }).map((r) => r.id), ['codex'])
	assert.equal(calls('codex').length, before, 'refresh leaves MCP registrations alone')
	writeFileSync(join(home, '.claude/skills/toucan/.installed-by-toucan'), '0.0.1\n')
	assert.deepEqual(agents.refresh({ home }).map((r) => r.id), ['claude'], 'refresh updates an old skill')
	assert.equal(agents.refresh({ home }).length, 0)
	agents.remove({ ids: ['cursor', 'claude', 'opencode'], home })
	assert.ok(!existsSync(join(home, '.claude/skills/toucan')))
	assert.equal(JSON.parse(readFileSync(join(home, '.cursor/mcp.json'), 'utf8')).mcpServers.toucan, undefined)
	assert.equal(JSON.parse(readFileSync(join(home, '.cursor/mcp.json'), 'utf8')).mcpServers.other.command, 'x')
	agents.remove({ home })
	assert.equal(readFileSync(join(home, '.gemini/skills/toucan/SKILL.md'), 'utf8'), 'mine', 'and left alone on remove')
	const desktop = agents.harnesses({ platform: 'darwin', home: '/h' }).find((h) => h.id === 'claude-desktop')
	assert.equal(desktop.file, '/h/Library/Application Support/Claude/claude_desktop_config.json')
	ok('agents: skill for those with a shell, MCP where needed, configs kept, undo works')

	// ---- MCP protocol, both eras
	const ask = async (method, params) => {
		let out
		await handle({ jsonrpc: '2.0', id: 1, method, params }, (m) => (out = m))
		return out
	}
	const legacy = await ask('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } })
	assert.equal(legacy.result.protocolVersion, '2025-06-18', 'a client on an older revision keeps it')
	assert.equal((await ask('initialize', { protocolVersion: '1999-01-01' })).result.protocolVersion, '2025-11-25', 'an unknown one gets the newest handshake revision')
	const discover = await ask('server/discover', { _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28' } })
	assert.ok(discover.result.supportedVersions.includes('2026-07-28'))
	assert.equal(discover.result.resultType, 'complete')
	assert.equal(discover.result.cacheScope, 'public')
	assert.equal((await ask('tools/list', { _meta: { 'io.modelcontextprotocol/protocolVersion': '1999-01-01' } })).error.code, -32022, 'a modern request on a version we lack')
	const { tools, ttlMs } = (await ask('tools/list', {})).result
	assert.ok(ttlMs > 0)
	for (const t of ['toucan_guide', 'toucan_project_canvas', 'toucan_open', 'toucan_summary', 'toucan_exec', 'toucan_draw', 'toucan_import', 'toucan_screenshot', 'toucan_cli']) assert.ok(tools.some((x) => x.name === t), t)
	assert.equal((await ask('nope')).error.code, -32601)
	assert.equal((await ask('tools/call', { name: 'toucan_guide', arguments: null })).result?.isError, undefined, 'null arguments are no arguments')
	assert.equal(await handle({ jsonrpc: '2.0', method: 'notifications/initialized' }, () => assert.fail('a notification gets no reply')), undefined)
	// It runs outside the agent's sandbox, so these must all be refused: other programs, files by path, the token, another server.
	const refused = [['setup'], ['update'], ['url'], ['my-extension'], ['--canvas', 'x', 'stop'], ['--server', 'http://elsewhere', 'canvases'], ['--server=http://elsewhere', 'canvases'], ['canvases', '--server', 'http://elsewhere'],
		['--canvas', '--x/evil', 'summary'], ['exec', '/etc/hostname'], ['import', '/etc/hostname'], ['draw', '/etc/hostname'], ['graph', '/tmp/out'], ['routine', 'save', 'leak', '/etc/hostname'], ['script', 'put', 'x', '/etc/hostname'],
		['new', 'x', '--from', '/etc/hostname'], ['new', 'x', '--from=/etc/hostname'], ['routine', 'save', 'leak'], [], 'nope', [1]]
	for (const args of refused) {
		const r = await ask('tools/call', { name: 'toucan_cli', arguments: { args } })
		assert.equal(r.result?.isError, true, `toucan_cli ${JSON.stringify(args)}`)
	}
	for (const [name, args] of [['toucan_summary', { canvas: '--x/evil' }], ['toucan_graph', { canvas: '../../x' }], ['toucan_open', { canvas: '--x' }], ['toucan_screenshot', { canvas: '--x/evil' }], ['toucan_project_canvas', { name: '--x/evil' }]]) {
		assert.equal((await ask('tools/call', { name, arguments: args })).result?.isError, true, name)
	}
	// The same trick at the CLI itself: a planted toucan---x/evil must not run.
	const planted = join(base, 'plant')
	mkdirSync(join(planted, 'toucan---x'), { recursive: true })
	writeFileSync(join(planted, 'toucan---x/evil'), `#!/bin/sh\ntouch "${join(base, 'pwned')}"\n`)
	chmodSync(join(planted, 'toucan---x/evil'), 0o755)
	await failure(['--canvas', '--x/evil', 'summary'], { cwd: planted })
	await failure(['--x/evil'], { cwd: planted })
	assert.ok(!existsSync(join(base, 'pwned')), 'no command can name a path to run')
	assert.match((await ask('tools/call', { name: 'toucan_guide', arguments: {} })).result.content[0].text, /toucan --canvas NAME summary/, 'the guide speaks `toucan`')
	ok('mcp: handshake and stateless eras, version errors, what toucan_cli may run')

	// ---- a server someone runs themselves is theirs
	const own = spawn(process.execPath, [join(ROOT, 'server/index.mjs'), '--port', String(port), '--data', join(base, 'own')], { stdio: 'pipe' })
	await new Promise((r) => own.stdout.on('data', (d) => String(d).includes('listening') && r()))
	assert.match(await toucan(['stop']).catch((e) => e.stdout), /wasn't started by/, "`toucan stop` won't stop it")
	assert.ok(own.exitCode === null)
	own.kill()
	await new Promise((r) => own.on('exit', r))
	assert.match(await failure(['canvases']), /isn't running/, "and commands won't start a rival to it")
	assert.match(await failure(['start']), /started by something else/, 'nor will `toucan start`, which would break its service')
	assert.match(await failure(['start', '--data', join(base, 'elsewhere')]), /started by something else/)
	assert.equal(JSON.parse(readFileSync(join(home, '.config/toucan/server.json'), 'utf8')).start, undefined, 'and its data directory stays its own')
	const own2 = spawn(process.execPath, [join(ROOT, 'server/index.mjs'), '--port', String(port), '--data', join(base, 'own')], { stdio: 'pipe' })
	await new Promise((r) => own2.stdout.on('data', (d) => String(d).includes('listening') && r()))
	assert.match(await failure(['start', '--port', '1234']), /run yourself/, 'a second server beside it is refused')
	assert.equal(JSON.parse(readFileSync(join(home, '.config/toucan/server.json'), 'utf8')).start, undefined)
	own2.kill()
	await new Promise((r) => own2.on('exit', r))
	assert.match(await toucan(['start', '--take-over']), /running at/, 'unless asked')
	assert.equal(JSON.parse(await toucan(['status'])).startedByToucan, true)
	assert.match(await toucan(['stop']), /stopped/)
	ok('a server run by hand or by a service is left in charge')

	// ---- first run: commands start the server, once, however many ask
	for (const first of [null, { start: {} }]) {
		rmSync(join(home, '.config/toucan/server.json'))
		if (first) writeFileSync(join(home, '.config/toucan/server.json'), JSON.stringify(first))
		const racers = await Promise.all([1, 2, 3, 4, 5].map(() => toucan(['canvases'])))
		assert.deepEqual(racers.map((r) => JSON.parse(r).length), [0, 0, 0, 0, 0], 'all see one server with one token')
		assert.match(await toucan(['stop']), /stopped/)
	}
	assert.equal(JSON.parse(await toucan(['status'])).running, false)
	await toucan(['canvases'])
	const status = JSON.parse(await toucan(['status']))
	assert.equal(status.running, true)
	assert.equal(status.startedByToucan, true)
	assert.equal(status.headless, true)
	assert.equal(status.data, join(home, '.local/share/toucan/canvases'))
	const inRepo = { cwd: join(repo, 'src') }
	rmSync(join(home, '.config/toucan/projects.json'))
	const made = JSON.parse(await toucan(['init', '--title', 'Shop'], inRepo))
	assert.equal(made.canvas, 'my-shop')
	assert.equal(made.created, true)
	assert.equal(made.project, repo)
	assert.ok(made.files.startsWith(status.data))
	assert.equal(JSON.parse(await toucan(['init'], { cwd: repo })).created, false)
	assert.equal(JSON.parse(await toucan(['meta', '--description', 'd'], inRepo)).description, 'd', "commands use the project's canvas")
	assert.match(await failure(['meta', '--description', 'd'], { cwd: base }), /which canvas/, 'outside it they ask')
	assert.match(await toucan(['--version']), /^\d+\.\d+\.\d+/)
	assert.match(await toucan(['--help']), /Getting going/)
	assert.match(await toucan(['open', 'my-shop'], { env: { ...process.env, DISPLAY: '' } }), /can't open a browser from here/, 'no screen here: it gives the link instead')
	assert.match(await toucan(['open', 'my-shop'], { env: { ...process.env, DISPLAY: ':0', TOUCAN_BROWSER: '/nonexistent/browser' } }), /can't open a browser from here/, "a browser that won't start doesn't count as opened")
	assert.doesNotMatch(await toucan(['open', 'my-shop'], { env: { ...process.env, TOUCAN_VIA_MCP: '1' } }), /token/, 'and over MCP the token stays out of the transcript')
	assert.doesNotMatch(await toucan(['url'], inRepo), /canvas=/, '`url` is the index unless a canvas was named')
	assert.match(await toucan(['url', '--canvas', 'my-shop'], inRepo), /canvas=my-shop/)
	assert.match(await toucan(['guide']), /^# toucan/)
	const doc = await toucan(['doctor'])
	assert.match(doc, /1 in /)
	assert.match(await toucan(['stop']), /stopped/)
	assert.equal(JSON.parse(await toucan(['status'])).running, false)
	assert.equal(JSON.parse(await toucan(['canvases'])).length, 1, 'and it starts again, with the canvas still there')
	assert.match(await toucan(['restart']), /running at/)
	const moved = port + 1
	assert.match(await toucan(['start', '--port', String(moved)], { env: { ...process.env, TOUCAN_PORT: '' } }), /`toucan restart` applies/, 'a server is running, so a new port waits rather than starting a second one')
	assert.match(await toucan(['restart'], { env: { ...process.env, TOUCAN_PORT: '' } }), new RegExp(`:${moved}`))
	assert.equal(JSON.parse(await toucan(['status'], { env: { ...process.env, TOUCAN_PORT: '' } })).running, true)
	assert.match(await toucan(['stop'], { env: { ...process.env, TOUCAN_PORT: '' } }), /stopped/)
	const cfgNow = JSON.parse(readFileSync(join(home, '.config/toucan/server.json'), 'utf8'))
	delete cfgNow.start
	writeFileSync(join(home, '.config/toucan/server.json'), JSON.stringify(cfgNow))
	ok('first run: self-starting server, one token under a race, stop and restart, project commands')
} finally {
	await toucan(['stop']).catch(() => {})
	rmSync(base, { recursive: true, force: true })
}
