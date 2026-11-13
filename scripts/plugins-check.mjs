// Plugins and plan sources as things that run other people's programs and write other people's files
// (server/plugins.mjs, server/sources.mjs): what a ref can and can't do to an adapter's arguments, what is left running
// after a time limit, when a plugin is asked about itself again, which folders are trusted, and a file plan swapped for
// a link under a write. scripts/plan-check.mjs has the protocol itself; no browser and no server here.
import assert from 'node:assert/strict'
import { execFile, execFileSync } from 'node:child_process'
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { KINDS, ask, createPlugins, scan } from '../server/plugins.mjs'
import { createSources } from '../server/sources.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ok = (m) => console.log(`ok  ${m}`)
const posix = process.platform !== 'win32'
const tmp = mkdtempSync(join(tmpdir(), 'toucan-plugins-'))
const program = (file, text) => (mkdirSync(dirname(file), { recursive: true }), writeFileSync(file, text), chmodSync(file, 0o755), file)
const alive = (pid) => {
	try {
		process.kill(pid, 0)
		// A killed process that nobody has collected yet still answers; it isn't running.
		return !existsSync(`/proc/${pid}/stat`) || !/^\d+ \(.*\) Z /.test(readFileSync(`/proc/${pid}/stat`, 'utf8'))
	} catch {
		return false
	}
}
const gone = async (pid, ms = 3000) => {
	for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 50))) if (!alive(pid)) return true
	return !alive(pid)
}
const strays = []
try {
	const data = join(tmp, 'data'), bin = join(tmp, 'bin'), files = join(tmp, 'files')
	for (const d of [data, bin, files]) mkdirSync(d)

	// ---- a ref is never an option ----------------------------------------------------------------------------------------
	// An adapter that writes down exactly what it was run with.
	const seen = join(tmp, 'argv.jsonl')
	program(join(bin, 'toucan-source-rec'), `#!/usr/bin/env node
import { appendFileSync, readFileSync } from 'node:fs'
const args = process.argv.slice(2)
appendFileSync(${JSON.stringify(seen)}, JSON.stringify({ args, protocol: process.env.TOUCAN_SOURCE_PROTOCOL, input: args[0] === 'write' ? readFileSync(0, 'utf8') : undefined }) + '\\n')
if (args[0] === 'list') console.log(JSON.stringify({ sources: [{ ref: 'a/b', title: 'B' }] }))
else if (args[0] === 'read') console.log(JSON.stringify({ plan: 1, source: { title: 'B' }, cursor: '1', fields: [], items: [] }))
else if (args[0] === 'changes') console.log(JSON.stringify({ cursor: '2', changed: true }))
else if (args[0] === 'write') console.log(JSON.stringify({ cursor: '2', results: [] }))
else process.exit(1)
`)
	const calls = () => (existsSync(seen) ? readFileSync(seen, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [])
	const sources = createSources({ data, path: bin, roots: () => [{ id: 'files', label: 'files', dir: files }] })
	const rec = sources.get('rec')
	await rec.list()
	await rec.read('a/b')
	await rec.changes('a/b', '17')
	await rec.changes('a/b', '-17')
	await rec.changes('a/b', undefined)
	await rec.changes('a/b', '--config=/tmp/evil')
	await rec.write('a/b', [{ op: 'create', mutation: 'm', set: { title: 'x' } }])
	assert.deepEqual(calls().map((c) => c.args), [
		['list'],
		['read', '--', 'a/b'],
		['changes', '--after', '17', '--', 'a/b'],
		['changes', '--after=-17', '--', 'a/b'],
		['changes', '--after', '', '--', 'a/b'],
		['changes', '--after=--config=/tmp/evil', '--', 'a/b'],
		['write', '--', 'a/b'],
	], 'the verb, options, then -- and the ref')
	assert.ok(calls().every((c) => c.protocol === '1'), 'TOUCAN_SOURCE_PROTOCOL=1')
	assert.deepEqual(JSON.parse(calls().at(-1).input).changes[0].mutation, 'm', 'the changes arrive on stdin')
	assert.deepEqual(KINDS.source.verbs, ['list', 'read -- REF', 'changes --after CURSOR -- REF', 'write -- REF'])
	const before = calls().length
	for (const ref of ['--config=/tmp/evil', '-x', '--', '', null, 7]) {
		const invalid = (e) => e.code === 'invalid' && /a plan's ref/.test(e.message)
		await assert.rejects(rec.read(ref), invalid, `read ${JSON.stringify(ref)}`)
		await assert.rejects(rec.changes(ref, '1'), invalid)
		await assert.rejects(rec.write(ref, []), invalid)
	}
	await assert.rejects(sources.get('file').read('--config=/tmp/evil', 'c'), (e) => e.code === 'invalid' && /can't start with "-"/.test(e.message), 'the file source too')
	assert.equal(calls().length, before, 'a ref that starts with - never reaches the adapter')
	for (const name of ['-x', '--help', '-']) assert.throws(() => sources.get(name), (e) => e.code === 'invalid' && /can't start with "-"/.test(e.message))
	ok('arguments: a ref is the one argument after --, a cursor the value of --after, and a ref or name that starts with - is refused')

	// The example people copy takes the convention, and the order an earlier draft used.
	const example = join(ROOT, 'examples/toucan-source-example.mjs')
	const env = { TOUCAN_SOURCE_EXAMPLE_FILE: join(tmp, 'example-state.json') }
	const ex = (...args) => ask(process.execPath, [example, ...args], { env })
	assert.equal((await ex('read', '--', 'demo/garden')).items.length, 6)
	assert.equal((await ex('read', 'demo/garden')).items.length, 6, 'the earlier form')
	for (const args of [['changes', '--after', '1', '--', 'demo/garden'], ['changes', '--after=1', '--', 'demo/garden'], ['changes', 'demo/garden', '--after', '1'], ['changes', 'demo/garden', '--after=1'], ['changes', '--after', '1', 'demo/garden']]) assert.deepEqual(await ex(...args), { cursor: '1', changed: false }, args.join(' '))
	assert.deepEqual(await ex('changes', '--', 'demo/garden'), { cursor: '1', changed: true }, 'no cursor: everything is news')
	assert.deepEqual(await ex('changes', '--after', '0', '--', 'demo/garden'), { cursor: '1', changed: true })
	assert.deepEqual(await ex('changes', '--after=-1', '--', 'demo/garden'), { cursor: '1', changed: true }, 'a cursor that starts with -')
	await assert.rejects(ex('read', '--', '--after=1'), (e) => e.code === 'not_found' && /no project --after=1/.test(e.message), 'after --, nothing is an option')
	await assert.rejects(ex('changes', '--', 'demo/garden', '--after', '1'), (e) => e.code === 'invalid' && /one REF/.test(e.message))
	await assert.rejects(ex('read', '--config=/tmp/evil'), (e) => e.code === 'invalid' && /unknown option --config/.test(e.message))
	await assert.rejects(ex('read', '--'), (e) => e.code === 'invalid' && /takes a REF/.test(e.message))
	await assert.rejects(ex('read', '--', 'constructor'), (e) => e.code === 'not_found')
	const wrote = await ask(process.execPath, [example, 'write', '--', 'demo/garden'], { env, input: JSON.stringify({ changes: [{ op: 'update', id: 'g4', version: 1, mutation: 'a', set: { stage: 'doing' } }] }) })
	assert.deepEqual([wrote.cursor, wrote.results[0].ok], ['2', true])
	ok('example adapter: --, --after CUR and --after=CUR in any place, and the earlier order still')

	// ---- a time limit ends everything the plugin started ---------------------------------------------------------------------
	if (posix) {
		const pidOf = async (file) => {
			for (const end = Date.now() + 3000; Date.now() < end; await new Promise((r) => setTimeout(r, 20))) if (existsSync(file) && readFileSync(file, 'utf8').trim()) break
			const pid = Number(readFileSync(file, 'utf8').trim())
			strays.push(pid)
			return pid
		}
		// A wrapper whose work is a child of its own, and that never answers.
		const slow = program(join(tmp, 'run/toucan-source-slow'), `#!/bin/sh\nsleep 30 &\necho $! > "$PIDFILE"\nwait\n`)
		let pidfile = join(tmp, 'slow.pid')
		const t0 = Date.now()
		const waiting = assert.rejects(ask(slow, ['changes', '--after', '', '--', 'x'], { timeout: 400, env: { PIDFILE: pidfile } }), (e) => e.code === 'unavailable' && e.why === 'took too long')
		const grandchild = await pidOf(pidfile)
		assert.ok(alive(grandchild), 'its child is running while it is waited for')
		await waiting
		assert.ok(Date.now() - t0 < 3000, 'the limit is the limit')
		assert.ok(await gone(grandchild), 'nothing it started is left running after the time limit')

		// One that says too much goes the same way.
		const loud = program(join(tmp, 'run/toucan-source-loud'), `#!/bin/sh\nsleep 30 &\necho $! > "$PIDFILE"\nwhile :; do echo aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa; done\n`)
		pidfile = join(tmp, 'loud.pid')
		await assert.rejects(ask(loud, ['read', '--', 'x'], { timeout: 20000, maxBuffer: 1 << 20, env: { PIDFILE: pidfile } }), (e) => e.code === 'invalid' && /more than 1 MB/.test(e.message))
		assert.ok(await gone(await pidOf(pidfile)), 'nor after too long an answer')

		// One that answers is unaffected, with its stdin, its failures and its own words as before.
		const fine = program(join(tmp, 'run/toucan-source-fine'), `#!/bin/sh\nif [ "$1" = fail ]; then echo '{"error": "forbidden", "message": "not yours"}' >&2; exit 4; fi\nif [ "$1" = plain ]; then echo 'connection refused' >&2; exit 2; fi\nprintf '{"got": "%s", "pgid": "%s", "pid": "%s"}' "$(cat)" "$(ps -o pgid= -p $$ | tr -d ' ')" "$$"\n`)
		const answered = await ask(fine, ['read'], { input: 'hello' })
		assert.equal(answered.got, 'hello')
		assert.equal(answered.pgid, answered.pid, 'it leads a process group of its own')
		await assert.rejects(ask(fine, ['fail']), (e) => e.code === 'forbidden' && e.message === 'not yours', 'a structured error keeps its code and words')
		await assert.rejects(ask(fine, ['plain']), (e) => e.code === 'unavailable' && /connection refused/.test(e.message))
		await assert.rejects(ask(join(tmp, 'run/nowhere'), ['read']), (e) => e.code === 'unavailable')

		// Something that left the group and still holds the pipe can't be killed with it, and must not keep toucan waiting or alive.
		let setsid = true
		try {
			execFileSync('setsid', ['true'])
		} catch {
			setsid = false
		}
		if (setsid) {
			const escaped = program(join(tmp, 'run/toucan-source-escaped'), `#!/bin/sh\nsetsid sleep 30 &\necho $! > "$PIDFILE"\nwait\n`)
			pidfile = join(tmp, 'escaped.pid')
			const started = Date.now()
			const { stdout } = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', `import { ask } from ${JSON.stringify(pathToFileURL(join(ROOT, 'server/plugins.mjs')).href)}\nawait ask(${JSON.stringify(escaped)}, ['read'], { timeout: 300 }).catch((e) => console.log(e.why))`], { env: { ...process.env, PIDFILE: pidfile }, timeout: 15000 })
			assert.equal(stdout.trim(), 'took too long')
			assert.ok(Date.now() - started < 8000, 'a process that outlives its plugin does not keep the server from ending')
			const left = await pidOf(pidfile)
			try {
				process.kill(left, 'SIGKILL')
			} catch {}
		}
		ok(`time limit: the plugin's whole process group is killed, on too long an answer too; one that answers is unaffected${setsid ? '; a runaway does not hold the server open' : ''}`)
	}

	// ---- describe is asked again when the program changes --------------------------------------------------------------------
	{
		const dbin = join(tmp, 'dbin'), count = join(tmp, 'describe.count')
		const write = (name) => program(join(dbin, 'toucan-source-desc'), `#!/bin/sh\necho x >> ${JSON.stringify(count)}\necho '{"name": "${name}", "version": "1"}'\n`)
		write('First')
		const plugins = createPlugins({ data, path: dbin, ttl: 0 })
		const titles = async () => (await plugins.list()).kinds.find((k) => k.kind === 'source').plugins.map((p) => p.title)
		const asked = () => readFileSync(count, 'utf8').trim().split('\n').length
		assert.deepEqual(await titles(), ['First'])
		assert.deepEqual(await titles(), ['First'])
		assert.equal(asked(), 1, 'unchanged, it is asked once')
		write('Second one')
		assert.deepEqual(await titles(), ['Second one'], 'a different size')
		// The same size, a later time.
		write('Third. one')
		const later = new Date(Date.now() + 5000)
		utimesSync(join(dbin, 'toucan-source-desc'), later, later)
		assert.deepEqual(await titles(), ['Third. one'], 'a later time')
		assert.deepEqual(await titles(), ['Third. one'])
		assert.equal(asked(), 3)
		// Replaced by a move, as an installer does it.
		program(join(tmp, 'next'), `#!/bin/sh\necho '{"name": "Moved here"}'\n`)
		utimesSync(join(tmp, 'next'), later, later)
		renameSync(join(tmp, 'next'), join(dbin, 'toucan-source-desc'))
		assert.deepEqual(await titles(), ['Moved here'], 'another file under the name')
		ok('describe: kept while the program is the same file, asked again when its time, size or file changes')
	}

	// ---- which folders are trusted -------------------------------------------------------------------------------------------
	{
		const t = join(tmp, 'trust')
		const plug = (dir, name = 'toucan-source-p') => program(join(t, dir, name), '#!/bin/sh\necho {}\n')
		const judge = (dir, name) => {
			const r = scan({ data, path: join(t, dir), kinds: ['source'] })
			assert.equal(r.found.length + r.refused.length, 1, `${dir}: one plugin`)
			return r.found.length ? 'found' : r.refused[0].reason.replaceAll(t, '')
		}
		plug('good/bin')
		assert.equal(judge('good/bin'), 'found', `a folder of one's own under ${tmpdir()}`)
		// Where installing a package puts programs.
		plug('proj/node_modules/.bin')
		plug('proj/node_modules/pkg/bin')
		plug('node_modules')
		assert.match(judge('proj/node_modules/.bin'), /^its folder is inside a node_modules folder \(\/proj\/node_modules\), where installing a package puts programs \(move the plugin to a folder of your own/)
		assert.match(judge('proj/node_modules/pkg/bin'), /^its folder is inside a node_modules folder \(\/proj\/node_modules\)/)
		assert.match(judge('node_modules'), /^its folder is a node_modules folder \(\/node_modules\)/)
		// A program that is a link into one: a package installed for every project is this.
		mkdirSync(join(t, 'global/bin'), { recursive: true })
		program(join(t, 'global/lib/node_modules/pkg/cli.js'), '#!/bin/sh\necho {}\n')
		symlinkSync('../lib/node_modules/pkg/cli.js', join(t, 'global/bin/toucan-source-p'))
		assert.match(judge('global/bin'), /^it links to \/global\/lib\/node_modules\/pkg\/cli\.js, whose folder is inside a node_modules folder \(\/global\/lib\/node_modules\)/)
		// A link to a program in another good folder is fine.
		mkdirSync(join(t, 'linked/bin'), { recursive: true })
		symlinkSync(join(t, 'good/bin/toucan-source-p'), join(t, 'linked/bin/toucan-source-p'))
		assert.equal(judge('linked/bin'), 'found')
		if (posix) {
			// A folder above it that others can write to: they can put another folder in its place.
			plug('loose/deep/bin')
			chmodSync(join(t, 'loose'), 0o777)
			assert.equal(judge('loose/deep/bin'), `its folder is inside /loose, which other users can write to (chmod go-w /loose)`)
			chmodSync(join(t, 'loose'), 0o775)
			assert.equal(judge('loose/deep/bin'), `its folder is inside /loose, which other users can write to (chmod go-w /loose)`, 'a group counts')
			// …and a link to a program under one.
			mkdirSync(join(t, 'tolink/bin'), { recursive: true })
			symlinkSync(join(t, 'loose/deep/bin/toucan-source-p'), join(t, 'tolink/bin/toucan-source-p'))
			assert.equal(judge('tolink/bin'), `it links to /loose/deep/bin/toucan-source-p, whose folder is inside /loose, which other users can write to (chmod go-w /loose)`)
			chmodSync(join(t, 'loose'), 0o755)
			assert.equal(judge('loose/deep/bin'), 'found', 'and the fix is the one it names')
			assert.equal(judge('tolink/bin'), 'found')
			// A sticky folder, like /tmp: anyone can add to it, nobody can replace another's folder in it.
			plug('sticky/mine/bin')
			chmodSync(join(t, 'sticky'), 0o1777)
			assert.equal(judge('sticky/mine/bin'), 'found', 'a private folder under a sticky one')
			// The folder itself open is refused whatever its sticky bit: anyone can add a program to it.
			plug('stickybin')
			chmodSync(join(t, 'stickybin'), 0o1777)
			assert.match(judge('stickybin'), /^its folder can be written to by other users \(chmod go-w /)
			// (A folder that belongs to another user is refused too. Only root can make one, so nothing here tries it.)
		}
		// A name can't start with "-", so it can't be taken for an option where a name is an argument.
		plug('names', 'toucan-source--x')
		plug('names', 'toucan-source---help')
		plug('names', 'toucan-profiles--x')
		const names = scan({ data, path: join(t, 'names') })
		assert.deepEqual(names.found, [])
		assert.deepEqual(names.refused.map((r) => [r.kind, r.id, r.reason]).sort(), [['profiles', '-x', '"-x" isn\'t a name: letters, digits, - and _'], ['source', '--help', '"--help" isn\'t a name: letters, digits, - and _'], ['source', '-x', '"-x" isn\'t a name: letters, digits, - and _']])
		const plugins = createPlugins({ data, path: [join(t, 'proj/node_modules/.bin'), join(t, 'good/bin')].join(delimiter), ttl: 0 })
		assert.equal(plugins.get('source', 'p')?.command, join(t, 'good/bin/toucan-source-p'), 'one refused does not hide a good one later on PATH')
		ok('trust: no node_modules, no folder above that others can write to unless sticky, links judged where they lead; reasons name the folder and the fix')
	}

	// ---- a file plan swapped for a link while it is written -------------------------------------------------------------------
	{
		const outside = join(tmp, 'outside')
		mkdirSync(outside)
		const plan = readFileSync(join(ROOT, 'examples/website-relaunch.plan.json'), 'utf8')
		const file = join(files, 'relaunch.plan.json'), REF = 'files/relaunch.plan.json'
		const change = (mutation) => [{ op: 'update', id: 'sitemap', version: 1, mutation, set: { title: `Sitemap ${mutation}` } }]
		const leftovers = () => readdirSync(files).filter((f) => f.endsWith('.tmp'))
		let swap = null
		const src = createSources({ data, path: '', roots: () => [{ id: 'files', label: 'files', dir: files }], seams: { beforeReplace: (path) => swap?.(path) } }).get('file')

		// As it should go: the file is rewritten in place, with the mode it had and nothing left beside it.
		writeFileSync(file, plan)
		if (posix) chmodSync(file, 0o640)
		const w = await src.write(REF, change('m1'), 'c')
		assert.deepEqual(w.results.map((r) => [r.ok, r.item.title]), [[true, 'Sitemap m1']])
		assert.equal(JSON.parse(readFileSync(file, 'utf8')).items.find((it) => it.id === 'sitemap').title, 'Sitemap m1')
		if (posix) assert.equal(statSync(file).mode & 0o777, 0o640, 'the mode is kept')
		assert.deepEqual(leftovers(), [])

		// Swapped for a link to a file outside, between the read and the write.
		const victim = join(outside, 'victim.json')
		writeFileSync(file, plan)
		writeFileSync(victim, plan)
		swap = (path) => (rmSync(path), symlinkSync(victim, path))
		await assert.rejects(src.write(REF, change('m2'), 'c'), (e) => e.code === 'conflict' && /files\/relaunch\.plan\.json was replaced on disk while it was being written, so nothing was written: .*leads outside files/.test(e.message))
		assert.equal(readFileSync(victim, 'utf8'), plan, 'nothing outside was written')
		assert.deepEqual(readdirSync(outside), ['victim.json'], 'nor added')
		assert.ok(lstatSync(file).isSymbolicLink(), 'the link is left as it was found')
		assert.deepEqual(leftovers(), [], 'and the new text is taken away again')

		// Swapped for a link to another plan in the same folder: not the file that was read, so not written either.
		const other = join(files, 'other.plan.json')
		rmSync(file)
		writeFileSync(file, plan)
		writeFileSync(other, plan)
		swap = (path) => (rmSync(path), symlinkSync(other, path))
		await assert.rejects(src.write(REF, change('m3'), 'c'), (e) => e.code === 'conflict' && /no longer the same file/.test(e.message))
		assert.equal(readFileSync(other, 'utf8'), plan)
		assert.deepEqual(leftovers(), [])

		// Taken away altogether.
		rmSync(file)
		writeFileSync(file, plan)
		swap = (path) => rmSync(path)
		await assert.rejects(src.write(REF, change('m4'), 'c'), (e) => e.code === 'conflict' && /no such file/.test(e.message))
		assert.deepEqual(leftovers(), [])
		assert.ok(!existsSync(file))

		// A ref that was a link all along (inside the folder) still writes the file it leads to, and stays a link.
		swap = null
		writeFileSync(other, plan)
		symlinkSync(other, file)
		await src.write(REF, change('m5'), 'c')
		assert.ok(lstatSync(file).isSymbolicLink())
		assert.equal(JSON.parse(readFileSync(other, 'utf8')).items.find((it) => it.id === 'sitemap').title, 'Sitemap m5')
		// …and one that leads outside is refused before anything is written, as it always was.
		rmSync(file)
		symlinkSync(victim, file)
		await assert.rejects(src.write(REF, change('m6'), 'c'), (e) => e.code === 'invalid' && /leads outside/.test(e.message))
		assert.equal(readFileSync(victim, 'utf8'), plan)
		ok('file source: a plan swapped for a link under a write is a conflict, nothing outside is written, the mode is kept')
	}
	console.log('\nplugins-check: all passed')
} finally {
	for (const pid of strays) {
		try {
			process.kill(pid, 'SIGKILL')
		} catch {}
	}
	// A folder a test left open to all is still ours to remove.
	rmSync(tmp, { recursive: true, force: true })
}
