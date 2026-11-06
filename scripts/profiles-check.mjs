// Agent profiles (server/profiles.mjs): sources on disk and on PATH, what a profile may and may not do, and a server
// that binds a canvas to one: the agent's name on the canvas, its folders in References, and refusing what won't load.
import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { homedir, tmpdir } from 'node:os'
import { delimiter, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { checkProfile, findSources, getProfile, listProfiles, profileInstructions } from '../server/profiles.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const tmp = mkdtempSync(join(tmpdir(), 'toucan-profiles-'))
let server
try {
	// An agent's own folder: doctrine, a notebook, a skill.
	const work = join(tmp, 'kiefer')
	for (const d of ['notes/questions', 'skills/brief']) mkdirSync(join(work, d), { recursive: true })
	writeFileSync(join(work, 'CHARTER.md'), '# Charter\n\nStudy how the foundation can use AI.\n')
	writeFileSync(join(work, 'notes/plan.md'), 'x'.repeat(5000))
	writeFileSync(join(work, 'skills/brief/SKILL.md'), '---\nname: brief\ndescription: Write a one-page brief for the board\n---\n\nSteps.\n')

	const data = join(tmp, 'data'), bin = join(tmp, 'bin')
	mkdirSync(join(data, '_profiles'), { recursive: true })
	mkdirSync(bin)
	writeFileSync(join(data, '_profiles/kiefer.json'), JSON.stringify({ name: 'Kiefer', description: 'Foundation strategy', color: 'violet', workdir: work, instructions: 'You study the foundation.', context: [{ path: 'CHARTER.md' }, { path: 'notes/plan.md', label: 'Plan' }, { path: 'gone.md' }], skills: ['skills/brief'], references: ['notes/questions'], budget: 1000 }))
	// A registry, as a program on PATH.
	writeFileSync(join(bin, 'toucan-profiles-reg'), `#!/usr/bin/env node
const [cmd, id] = process.argv.slice(2)
if (cmd === 'list') console.log(JSON.stringify({ profiles: [{ id: 'astrid', name: 'Astrid', description: 'Runs the newsroom' }, { id: '../bad' }] }))
else if (cmd === 'get' && id === 'astrid') console.log(JSON.stringify({ name: 'Astrid', workdir: ${JSON.stringify(work)}, instructions: 'You run the newsroom.' }))
else if (cmd === 'get' && id === 'loose') console.log(JSON.stringify({ name: 'Loose', workdir: 'relative/path' }))
else { console.error('no such agent: ' + id); process.exit(1) }
`)
	chmodSync(join(bin, 'toucan-profiles-reg'), 0o755)
	writeFileSync(join(bin, 'toucan-profiles-broken'), '#!/bin/sh\necho not json\n')
	chmodSync(join(bin, 'toucan-profiles-broken'), 0o755)
	writeFileSync(join(bin, 'toucan-profiles-noexec'), '')

	// Where an agent could put a program, the server doesn't look: inside toucan or its data, a folder anyone can write to.
	const planted = join(data, 'bin'), open = join(tmp, 'open'), mine = join(tmp, 'toucan-root/node_modules/.bin')
	for (const d of [planted, open, mine]) mkdirSync(d, { recursive: true })
	for (const d of [planted, open, mine]) writeFileSync(join(d, 'toucan-profiles-planted'), '#!/bin/sh\necho {}\n'), chmodSync(join(d, 'toucan-profiles-planted'), 0o755)
	chmodSync(open, 0o777)
	const sources = findSources({ data, path: [bin, '/nonexistent', 'relative/bin', planted, open, mine].join(delimiter), exclude: [join(tmp, 'toucan-root')] })
	assert.deepEqual(sources.map((s) => s.id).sort(), ['broken', 'local', 'reg'], 'files, and programs that can run')
	const listed = await listProfiles(sources)
	assert.deepEqual(listed.profiles.map((p) => p.ref).sort(), ['local/kiefer', 'reg/astrid'], 'a bad id is dropped')
	assert.equal(listed.errors.length, 1)
	assert.match(listed.errors[0].error, /broken.*JSON/)
	console.log('ok  profiles: sources on disk and on PATH, and a broken one reported without hiding the rest')

	const k = await getProfile('local/kiefer', sources)
	assert.equal(k.name, 'Kiefer')
	assert.deepEqual(k.context.map((c) => [c.label, c.missing ?? false]), [['CHARTER.md', false], ['Plan', false], ['gone.md', true]])
	assert.ok(k.context.reduce((n, c) => n + c.chars, 0) <= 1000 && k.context[1].truncated, 'the budget holds')
	assert.ok(k.problems.some((p) => /gone\.md/.test(p)), 'a missing file is reported')
	assert.deepEqual(k.skills.map((s) => [s.name, s.description]), [['brief', 'Write a one-page brief for the board']], "a skill's name comes from its own front matter")
	assert.equal(k.writable, undefined, 'a profile grants no writing')
	assert.equal(k.references[0].dir, join(work, 'notes/questions'))
	const text = profileInstructions(k)
	for (const want of ['You are Kiefer', 'You study the foundation.', '# Charter', 'brief: Write a one-page brief', 'gone.md', "write only in this canvas's files folder"]) assert.ok(text.includes(want), `instructions carry ${want}`)
	for (const [ref, why] of [['reg/nobody', /no such agent/], ['reg/loose', /absolute path/], ['local/none', /no profile local\/none/], ['nosource/x', /no profile source/], ['../x', /SOURCE\/ID/]]) await assert.rejects(getProfile(ref, sources), why, ref)
	mkdirSync(join(work, '.secret'))
	writeFileSync(join(work, '.secret/key'), 'KEY')
	const wide = checkProfile({ workdir: work, writable: ['.'], references: ['/etc', '..', '.secret'], context: ['/etc/hostname', '../kiefer/../data/_profiles/kiefer.json', '.secret/key'] }, 't/t')
	assert.deepEqual([wide.references, wide.context], [[], []], "nothing outside the agent's own folder, or hidden in it, is read or shared")
	assert.ok(wide.problems.some((p) => /can't grant writing/.test(p)), 'asking for writable folders is reported, not granted')
	for (const dir of ['/', homedir()]) assert.throws(() => checkProfile({ workdir: dir }, 't/t'), /too broad/, `${dir} is too broad`)
	console.log('ok  profiles: context within a budget, skills, folders only as named, and refusals that say why')

	// A server with these sources: bind a canvas, see the agent's name and folders, refuse a profile that won't load.
	const home = join(tmp, 'home')
	mkdirSync(home)
	const port = await new Promise((r) => {
		const s = createServer().listen(0, '127.0.0.1', () => (r(s.address().port), s.close()))
	})
	const env = { ...process.env, HOME: home, PATH: `${bin}${delimiter}${process.env.PATH}` }
	for (const k2 of ['TOUCAN_URL', 'TOUCAN_CANVAS', 'TOUCAN_AGENT']) delete env[k2]
	server = spawn(process.execPath, [join(ROOT, 'server/index.mjs'), '--port', String(port), '--data', data], { env, stdio: ['ignore', 'pipe', 'pipe'] })
	let log = ''
	server.stdout.on('data', (d) => (log += d))
	server.stderr.on('data', (d) => (log += d))
	for (let i = 0; i < 50 && !log.includes('listening'); i++) await new Promise((r) => setTimeout(r, 100))
	const cli = (...a) => promisify(execFile)(process.execPath, [join(ROOT, 'bin/toucan.mjs'), ...a], { env }).then((r) => r.stdout)
	await cli('new', 'board', '--title', 'Board prep')
	const all = JSON.parse(await cli('profiles'))
	assert.deepEqual(all.profiles.map((p) => p.ref).sort(), ['local/kiefer', 'reg/astrid'])
	await assert.rejects(cli('--canvas', 'board', 'meta', '--profile', 'reg/loose'), /absolute path/)
	assert.equal(JSON.parse(await cli('--canvas', 'board', 'meta', '--profile', 'local/kiefer')).profile.name, 'Kiefer')
	const shown = JSON.parse(await cli('--canvas', 'board', 'profile'))
	assert.equal(shown.workdir, work)
	assert.ok(!JSON.stringify(shown).includes('Study how the foundation'), "the profile route lists what's read, not the text")
	const refsList = JSON.parse(await cli('--canvas', 'board', 'references'))
	assert.ok(refsList.files.includes('agent/notes/questions') === false && refsList.roots.some((r) => r.id === 'agent'), 'the agent folder is a root')
	writeFileSync(join(work, 'notes/questions/q1.md'), '# Q1')
	const token = JSON.parse(readFileSync(join(home, '.config/toucan/server.json'), 'utf8')).token
	const ref = await fetch(`http://127.0.0.1:${port}/api/canvases/board/reference?ref=agent/q1.md`, { headers: { authorization: `Bearer ${token}` } })
	assert.equal(await ref.text(), '# Q1', "the agent's shared folder reads as agent/…")
	assert.match(JSON.parse(await cli('canvases')).find?.((c) => c.name === 'board')?.profile?.name ?? JSON.stringify(JSON.parse(await cli('canvases'))), /Kiefer/)
	await cli('--canvas', 'board', 'meta', '--profile', 'none')
	assert.equal(JSON.parse(await cli('--canvas', 'board', 'profile')), null)
	console.log("ok  profiles: a canvas binds to one, shares its folders, and lets go of it")

	// An agent of your own, from its folder: no registry, no JSON by hand.
	const own = join(tmp, 'my-agent')
	mkdirSync(own)
	writeFileSync(join(own, 'AGENTS.md'), '# My agent\n\nYou review pull requests.\n')
	const made = JSON.parse(await cli('profiles', 'add', 'reviewer', '--workdir', own))
	assert.deepEqual([made.ref, made.name, made.context.map((c) => c.label)], ['local/reviewer', 'Reviewer', ['AGENTS.md']], 'named from its id, starting from its AGENTS.md')
	assert.ok(JSON.parse(readFileSync(join(data, '_profiles/reviewer.json'), 'utf8')).workdir === own)
	await assert.rejects(cli('profiles', 'add', 'reviewer', '--workdir', own), /already exists/)
	await assert.rejects(cli('profiles', 'add', 'everything', '--workdir', home), /too broad/, "the server's own home folder is too broad")
	assert.equal(JSON.parse(await cli('--canvas', 'board', 'meta', '--profile', 'local/reviewer')).profile.name, 'Reviewer')
	console.log('ok  profiles: `profiles add` makes one from a folder, and a canvas can work with it at once')
} catch (e) {
	throw e
} finally {
	server?.kill()
	await new Promise((r) => setTimeout(r, 200))
	rmSync(tmp, { recursive: true, force: true })
}
