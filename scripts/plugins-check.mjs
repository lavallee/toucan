// Plugins and plan sources as things that run other people's programs and write other people's files
// (server/plugins.mjs, server/sources.mjs): what a ref can and can't do to an adapter's arguments, what is left running
// after a time limit, when a plugin is asked about itself again, which programs are trusted, and a file plan swapped for
// a link under a write. scripts/plan-check.mjs has the protocol itself; no browser and no server here.
import assert from 'node:assert/strict'
import { execFile, execFileSync } from 'node:child_process'
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { KINDS, ask, createPlugins, privateGroup, scan, unmappedRoot } from '../server/plugins.mjs'
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

	// ---- which programs are trusted -------------------------------------------------------------------------------------------
	// Whether a group is one user's alone, from the text of the two files that say.
	{
		const passwd = 'root:x:0:0::/root:/bin/sh\n# a comment\nme:x:1000:1000:Me:/home/me:/bin/sh\nother:x:1001:1001::/home/other:/bin/sh\n'
		const group = 'root:x:0:\nme:x:1000:\nother:x:1001:\nwheel:x:998:me,other\n'
		const mine = (over = {}) => privateGroup({ uid: 1000, gid: 1000, group, passwd, ...over })
		assert.equal(mine(), true, 'the user\'s primary group, with nobody else in it')
		assert.equal(mine({ group: group.replace('me:x:1000:', 'me:x:1000:me') }), true, 'listing the user is the same thing')
		assert.equal(mine({ group: group.replace('me:x:1000:', 'me:x:1000:other') }), false, 'another member listed')
		assert.equal(mine({ group: group.replace('me:x:1000:', 'me:x:1000:me,other') }), false)
		assert.equal(mine({ passwd: passwd + 'guest:x:1002:1000::/home/guest:/bin/sh\n' }), false, 'another account with it as its primary group')
		assert.equal(mine({ gid: 998 }), false, 'a group the user is merely in')
		assert.equal(mine({ uid: 1001 }), false, 'somebody else\'s group')
		assert.equal(mine({ group: null }), false, 'the group file can\'t be read')
		assert.equal(mine({ passwd: null }), false, 'nor the accounts')
		assert.equal(mine({ group: '', passwd: '' }), false)
		assert.equal(mine({ passwd: passwd.replace(/^me:.*\n/m, '') }), false, 'the user isn\'t in the file: kept somewhere else')
		assert.equal(mine({ group: group.replace('me:x:1000:\n', '') }), false, 'nor the group')
		assert.equal(mine({ group: group + '+:::\n' }), false, 'a line that sends the question elsewhere')
		assert.equal(mine({ passwd: passwd + '+::::::\n' }), false)
		ok('private group: the user\'s primary group with no other member and no other account; anything unclear is a no')
	}
	{
		const t = join(tmp, 'trust')
		const plug = (dir, name = 'toucan-source-p') => program(join(t, dir, name), '#!/bin/sh\necho {}\n')
		const link = (to, dir, name = 'toucan-source-p') => (mkdirSync(join(t, dir), { recursive: true }), symlinkSync(to, join(t, dir, name)))
		// The one plugin in a PATH folder: 'found', or why not, with the test's own folder cut out of the words.
		const judge = (dir, opts = {}) => {
			const r = scan({ data, path: join(t, dir), pluginPath: '', kinds: ['source'], ...opts })
			assert.equal(r.found.length + r.refused.length, 1, `${dir}: one plugin`)
			return r.found.length ? 'found' : r.refused[0].reason.replaceAll(t, '')
		}
		const orAdd = (dir) => `or add ${dir} to TOUCAN_PLUGIN_PATH if you trust it`
		// The one plugin in a folder the operator vouches for, with nothing on PATH.
		const vouch = (dir, opts = {}) => judge('nowhere', { pluginPath: dir, ...opts })
		const noHint = (reason) => assert.doesNotMatch(reason, /TOUCAN_PLUGIN_PATH/, 'naming the folder there would not help')

		// A folder of one's own.
		plug('mine/bin')
		assert.equal(judge('mine/bin'), 'found', `a folder of one's own under ${tmpdir()}`)
		// A program installed with a package manager: a link in a bin folder to a file under a node_modules.
		program(join(t, 'global/lib/node_modules/pkg/bin/cli.js'), '#!/bin/sh\necho {}\n')
		link('../lib/node_modules/pkg/bin/cli.js', 'global/bin')
		assert.equal(judge('global/bin'), 'found', 'npm i -g')
		plug('proj/node_modules/.bin')
		assert.equal(judge('proj/node_modules/.bin'), 'found', 'a node_modules that isn\'t toucan\'s is a folder like any other')
		// A link to a program in another good folder.
		link(join(t, 'mine/bin/toucan-source-p'), 'linked/bin')
		assert.equal(judge('linked/bin'), 'found')

		// Inside toucan's data or its own folder: refused, and nothing the operator sets changes that.
		program(join(data, 'pbin/toucan-source-p'), '#!/bin/sh\necho {}\n')
		const INSIDE = `inside toucan's own folder or its data, where agents can write`
		const inData = scan({ data, path: join(data, 'pbin'), pluginPath: '', kinds: ['source'] })
		assert.deepEqual([inData.found, inData.refused.map((r) => r.reason)], [[], [`its folder is ${INSIDE}`]])
		plug('root/node_modules/.bin')
		assert.equal(judge('root/node_modules/.bin', { exclude: [join(t, 'root')] }), `its folder is ${INSIDE}`, 'toucan\'s own node_modules/.bin')
		link(join(t, 'root/node_modules/.bin/toucan-source-p'), 'intoroot/bin')
		assert.equal(judge('intoroot/bin', { exclude: [join(t, 'root')] }), `it links to /root/node_modules/.bin/toucan-source-p, ${INSIDE}`)
		assert.equal(judge('intoroot/bin'), 'found', 'the same link, with nothing fenced off')
		// Not executable.
		writeFileSync(plug('noexec/bin'), '')
		chmodSync(join(t, 'noexec/bin/toucan-source-p'), 0o644)
		// (Root may run anything with an x bit anywhere on it, and this file has none.)
		assert.equal(judge('noexec/bin'), `it isn't executable (chmod +x /noexec/bin/toucan-source-p)`)
		// Not a file.
		mkdirSync(join(t, 'adir/bin/toucan-source-p'), { recursive: true })
		assert.equal(judge('adir/bin'), 'it isn\'t a file')
		for (const reason of [inData.refused[0].reason, judge('noexec/bin'), judge('adir/bin'), judge('intoroot/bin', { exclude: [join(t, 'root')] })]) noHint(reason)

		if (posix) {
			const uid = process.getuid(), gid = process.getgid()
			const shared = { who: { groupIsPrivate: () => false } }, alone = { who: { groupIsPrivate: () => true } }

			// A folder its group can write to (what a umask of 002 leaves): fine when the group is the user's alone.
			plug('grp/bin')
			chmodSync(join(t, 'grp/bin'), 0o775)
			const G = statSync(join(t, 'grp/bin')).gid
			const groupRefusal = (what, path, dir, which = `isn't known to be yours alone`) => `${what} can be written to by group ${G}, which ${which} (chmod g-w ${path}, ${orAdd(dir)})`
			assert.equal(judge('grp/bin', alone), 'found', 'a group of one')
			assert.equal(judge('grp/bin', shared), groupRefusal('its folder', '/grp/bin', '/grp/bin'), 'a group with others in it')
			assert.equal(judge('grp/bin', { who: { ...alone.who, gid: G + 1 } }), groupRefusal('its folder', '/grp/bin', '/grp/bin', `isn't your own`), 'a group that isn\'t the user\'s primary one, whoever is in it')
			// And on this machine, as it is: read the way a person would check it.
			const rows = (file) => {
				try {
					return readFileSync(file, 'utf8').split('\n').filter((l) => l.trim() && !l.startsWith('#')).map((l) => l.split(':'))
				} catch {
					return null
				}
			}
			const accounts = rows('/etc/passwd'), groups = rows('/etc/group')
			const me = (accounts ?? []).filter((r) => Number(r[2]) === uid)
			const here = !!accounts && !!groups && G === gid
				&& ![...accounts, ...groups].some((r) => /^[+-]/.test(r[0]))
				&& me.some((r) => Number(r[3]) === gid)
				&& !accounts.some((r) => Number(r[3]) === gid && Number(r[2]) !== uid)
				&& groups.some((r) => Number(r[2]) === gid)
				&& groups.filter((r) => Number(r[2]) === gid).every((r) => (r[3] ?? '').split(',').filter(Boolean).every((m) => me.some((a) => a[0] === m.trim())))
			if (here) assert.equal(judge('grp/bin'), 'found', 'this user\'s group is private here')
			else assert.match(judge('grp/bin'), /^its folder can be written to by group \d+, which isn't (known to be yours alone|your own) \(chmod g-w \/grp\/bin, or add \/grp\/bin to TOUCAN_PLUGIN_PATH if you trust it\)$/, 'this user\'s group is shared here, or can\'t be read')
			chmodSync(join(t, 'grp/bin'), 0o755)
			assert.equal(judge('grp/bin', shared), 'found', 'and the fix is the one it names')
			// The program itself, the same.
			plug('gfile/bin')
			chmodSync(join(t, 'gfile/bin/toucan-source-p'), 0o775)
			assert.equal(judge('gfile/bin', alone), 'found')
			assert.equal(judge('gfile/bin', shared), groupRefusal('it', '/gfile/bin/toucan-source-p', '/gfile/bin'))
			// The group database is read once a scan, however many folders ask.
			plug('grp2/bin', 'toucan-source-q')
			chmodSync(join(t, 'grp2/bin'), 0o775)
			let asked = 0
			const both = scan({ data, path: [join(t, 'gfile/bin'), join(t, 'grp2/bin')].join(delimiter), pluginPath: '', kinds: ['source'], who: { groupIsPrivate: () => (asked++, true) } })
			assert.deepEqual([both.found.length, both.refused.length, asked], [2, 0, 1])

			// Open to everyone: refused, the folder or the program.
			plug('open/bin')
			chmodSync(join(t, 'open/bin'), 0o777)
			assert.equal(judge('open/bin', alone), `its folder can be written to by other users (chmod o-w /open/bin, ${orAdd('/open/bin')})`)
			plug('ofile/bin')
			chmodSync(join(t, 'ofile/bin/toucan-source-p'), 0o777)
			assert.equal(judge('ofile/bin', alone), `it can be written to by other users (chmod o-w /ofile/bin/toucan-source-p, ${orAdd('/ofile/bin')})`)
			chmodSync(join(t, 'ofile/bin/toucan-source-p'), 0o755)
			assert.equal(judge('ofile/bin'), 'found')

			// A folder above that everyone can write to: they can put another folder in its place.
			plug('loose/deep/bin')
			chmodSync(join(t, 'loose'), 0o777)
			assert.equal(judge('loose/deep/bin'), `its folder is inside /loose, which other users can write to (chmod o-w /loose, ${orAdd('/loose/deep/bin')})`)
			// …and a link to a program under one, or in an open folder.
			link(join(t, 'loose/deep/bin/toucan-source-p'), 'tolink/bin')
			assert.equal(judge('tolink/bin'), `it links to /loose/deep/bin/toucan-source-p, whose folder is inside /loose, which other users can write to (chmod o-w /loose, ${orAdd('/tolink/bin')})`)
			link(join(t, 'open/bin/toucan-source-p'), 'toopen/bin')
			assert.equal(judge('toopen/bin', alone), `it links to /open/bin/toucan-source-p, whose folder can be written to by other users (chmod o-w /open/bin, ${orAdd('/toopen/bin')})`)
			// A group that can write above is let be, whoever is in it.
			chmodSync(join(t, 'loose'), 0o775)
			assert.equal(judge('loose/deep/bin', shared), 'found', 'a group-writable folder above')
			assert.equal(judge('tolink/bin', shared), 'found')
			// A sticky folder, like /tmp: anyone can add to it, nobody can replace another's folder in it.
			plug('sticky/mine/bin')
			chmodSync(join(t, 'sticky'), 0o1777)
			assert.equal(judge('sticky/mine/bin', shared), 'found', 'a private folder under a sticky one')
			// …or another's program: one found in a sticky folder itself is still asked whose it is.
			plug('stickybin')
			chmodSync(join(t, 'stickybin'), 0o1777)
			assert.equal(judge('stickybin', shared), 'found')

			// Somebody else's: seen from another uid, everything here is. (Only root can make one for real.)
			if (uid !== 0) {
				const stranger = { who: { uid: uid + 1, gid: gid + 1, groupIsPrivate: () => true } }
				assert.equal(judge('mine/bin', stranger), `its folder belongs to another user, uid ${uid} (add /mine/bin to TOUCAN_PLUGIN_PATH if you trust it)`)
				assert.equal(judge('stickybin', stranger), `its folder belongs to another user, uid ${uid} (add /stickybin to TOUCAN_PLUGIN_PATH if you trust it)`)
			}

			// A sandboxed service (a user unit with PrivateTmp, a rootless container) can't see root: root's folders read as
			// nobody's. There, nobody's are taken as root's, or every plugin would be refused; a named stranger's still isn't.
			if (uid !== 0) {
				const sandboxed = { who: { uid: uid + 1, gid: gid + 1, groupIsPrivate: () => true, nobody: uid } }
				assert.equal(judge('mine/bin', sandboxed), 'found', 'root seen as nobody')
				assert.equal(judge('mine/bin', { who: { ...sandboxed.who, nobody: uid + 7 } }), `its folder belongs to another user, uid ${uid} (add /mine/bin to TOUCAN_PLUGIN_PATH if you trust it)`)
			}
			assert.equal(unmappedRoot('         0          0 4294967295\n', '65534\n'), null, 'the whole range mapped: root is root')
			assert.equal(unmappedRoot('      1000       1000          1\n', '65534\n'), 65534, 'only this user mapped')
			assert.equal(unmappedRoot('      1000       1000          1\n', null), 65534)
			assert.equal(unmappedRoot('         0       1000          1\n', '65534\n'), null, 'root inside the namespace')
			assert.equal(unmappedRoot(null, null), null, 'no /proc: nothing assumed')

			// What the operator vouches for is asked none of that…
			chmodSync(join(t, 'loose'), 0o777)
			assert.equal(vouch(join(t, 'open/bin'), shared), 'found', 'a folder PATH would refuse')
			assert.equal(vouch(join(t, 'loose/deep/bin')), 'found')
			assert.equal(vouch(join(t, 'grp2/bin'), shared), 'found')
			if (uid !== 0) assert.equal(vouch(join(t, 'mine/bin'), { who: { uid: uid + 1 } }), 'found', 'another user\'s')
		}
		assert.equal(vouch(join(t, 'mine/bin')), 'found')
		// …but still to be outside toucan's data and folder, executable, and a file, in a folder named in full.
		const vouchedData = scan({ data, path: '', pluginPath: join(data, 'pbin'), kinds: ['source'] })
		assert.deepEqual([vouchedData.found, vouchedData.refused.map((r) => r.reason)], [[], [`its folder is ${INSIDE}`]])
		assert.equal(vouch(join(t, 'root/node_modules/.bin'), { exclude: [join(t, 'root')] }), `its folder is ${INSIDE}`)
		assert.equal(vouch(join(t, 'intoroot/bin'), { exclude: [join(t, 'root')] }), `it links to /root/node_modules/.bin/toucan-source-p, ${INSIDE}`)
		assert.equal(vouch(join(t, 'noexec/bin')), `it isn't executable (chmod +x /noexec/bin/toucan-source-p)`)
		assert.equal(vouch(join(t, 'adir/bin')), 'it isn\'t a file')
		assert.equal(vouch(relative(process.cwd(), join(t, 'mine/bin'))), 'its folder is on TOUCAN_PLUGIN_PATH as a relative path, which means a different folder in every directory')
		assert.equal(judge(relative(process.cwd(), join(t, 'mine/bin')), { path: relative(process.cwd(), join(t, 'mine/bin')) }), 'its folder is on PATH as a relative path, which means a different folder in every directory')

		// The operator's folders come first, so theirs wins a name; and a folder named twice is looked in once.
		const clash = scan({ data, path: join(t, 'mine/bin'), pluginPath: join(t, 'global/bin'), kinds: ['source'] })
		assert.deepEqual(clash.found, [{ kind: 'source', id: 'p', command: join(t, 'global/bin/toucan-source-p') }])
		assert.deepEqual(clash.refused, [{ kind: 'source', id: 'p', path: join(t, 'mine/bin/toucan-source-p'), reason: `${join(t, 'global/bin/toucan-source-p')} comes first, in TOUCAN_PLUGIN_PATH` }])
		const onPath = scan({ data, path: [join(t, 'mine/bin'), join(t, 'global/bin')].join(delimiter), pluginPath: '', kinds: ['source'] })
		assert.deepEqual(onPath.refused.map((r) => r.reason), [`${join(t, 'mine/bin/toucan-source-p')} comes first on PATH`])
		const twice = scan({ data, path: [join(t, 'mine/bin'), join(t, 'mine/bin')].join(delimiter), pluginPath: join(t, 'mine/bin'), kinds: ['source'] })
		assert.deepEqual([twice.found.length, twice.refused], [1, []])
		// Given nothing, the variable is what is read; and the server's own plugins take the option.
		const had = process.env.TOUCAN_PLUGIN_PATH
		process.env.TOUCAN_PLUGIN_PATH = join(t, 'global/bin')
		try {
			assert.deepEqual(scan({ data, path: '', kinds: ['source'] }).found.map((p) => p.command), [join(t, 'global/bin/toucan-source-p')])
			assert.equal(createPlugins({ data, path: '', ttl: 0 }).get('source', 'p')?.command, join(t, 'global/bin/toucan-source-p'))
			assert.equal(createPlugins({ data, path: '', pluginPath: '', ttl: 0 }).get('source', 'p'), null, 'the option, given, is the whole of it')
		} finally {
			if (had === undefined) delete process.env.TOUCAN_PLUGIN_PATH
			else process.env.TOUCAN_PLUGIN_PATH = had
		}
		const vouched = createPlugins({ data, path: join(t, 'mine/bin'), pluginPath: join(t, 'global/bin'), ttl: 0 })
		assert.equal(vouched.get('source', 'p')?.command, join(t, 'global/bin/toucan-source-p'))
		assert.match(vouched.whyNot('source', 'nope'), /looks for toucan-source-nope on PATH, and in TOUCAN_PLUGIN_PATH/)

		// A name can't start with "-", so it can't be taken for an option where a name is an argument.
		plug('names', 'toucan-source--x')
		plug('names', 'toucan-source---help')
		plug('names', 'toucan-profiles--x')
		const names = scan({ data, path: join(t, 'names'), pluginPath: '' })
		assert.deepEqual(names.found, [])
		assert.deepEqual(names.refused.map((r) => [r.kind, r.id, r.reason]).sort(), [['profiles', '-x', '"-x" isn\'t a name: letters, digits, - and _'], ['source', '--help', '"--help" isn\'t a name: letters, digits, - and _'], ['source', '-x', '"-x" isn\'t a name: letters, digits, - and _']])
		const plugins = createPlugins({ data, path: [join(data, 'pbin'), join(t, 'mine/bin')].join(delimiter), pluginPath: '', ttl: 0 })
		assert.equal(plugins.get('source', 'p')?.command, join(t, 'mine/bin/toucan-source-p'), 'one refused does not hide a good one later on PATH')
		assert.match((await plugins.list()).kinds.find((k) => k.kind === 'source').refused[0].reason, /^its folder is inside toucan's own folder/)
		ok('trust: one\'s own or root\'s, closed to everyone and to any group but one\'s own private one, under folders nobody else owns or all can write to unless sticky; npm i -g works; TOUCAN_PLUGIN_PATH vouches, and comes first; every refusal says what is wrong and the fix')
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
