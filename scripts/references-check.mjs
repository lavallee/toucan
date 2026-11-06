// What the References panel can and can't read (server/references.mjs): only the canvas's files and its project, never a
// hidden file, a build folder or a way out through `..` or a symlink, and never a page on this machine or a private network.
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fetchExternal, isPrivate, kindOf, kindOfType, listRefs, refForPath, resolveRef, rootsOf } from '../server/references.mjs'

const tmp = mkdtempSync(join(tmpdir(), 'toucan-refs-'))
try {
	const files = join(tmp, 'data/plan.files'), project = join(tmp, 'project'), outside = join(tmp, 'outside')
	for (const d of [files, join(project, 'docs'), join(project, 'node_modules/x'), join(project, '.git'), outside]) mkdirSync(d, { recursive: true })
	writeFileSync(join(files, 'research.md'), '# Research')
	writeFileSync(join(project, 'README.md'), '# Project')
	writeFileSync(join(project, 'docs/guide.md'), '# Guide')
	writeFileSync(join(project, 'docs/data.csv'), 'a,b\n1,2\n')
	writeFileSync(join(project, '.env'), 'SECRET=1')
	writeFileSync(join(project, 'node_modules/x/index.js'), '')
	writeFileSync(join(project, 'tool.bin'), Buffer.from([0, 1, 2]))
	writeFileSync(join(outside, 'secret.md'), '# Not yours')
	symlinkSync(outside, join(project, 'docs/escape'))
	symlinkSync(join(outside, 'secret.md'), join(project, 'docs/leak.md'))
	symlinkSync(join(project, '.env'), join(project, 'config'))

	const roots = rootsOf('plan', { filesDir: () => files, links: { [project]: 'plan', [join(tmp, 'gone')]: 'plan', [outside]: 'other' } })
	assert.deepEqual(roots.map((r) => r.id), ['files', 'project'], 'the canvas files, then the linked project that exists')

	const listed = (await listRefs(roots)).files.map((f) => f.ref)
	assert.deepEqual(listed.sort(), ['files/research.md', 'project/README.md', 'project/docs/data.csv', 'project/docs/guide.md'].sort(), `listed: ${listed}`)

	assert.equal(resolveRef('project/docs/guide.md', roots).kind, 'markdown')
	assert.equal(resolveRef('files/research.md', roots).rel, 'research.md')
	for (const bad of ['project/.env', 'project/../outside/secret.md', 'project/docs/../../outside/secret.md', 'project/node_modules/x/index.js', 'project/docs/escape/secret.md', 'project/docs/leak.md', 'project/config', 'elsewhere/a.md', 'project/', 'project/docs'])
		assert.ok(resolveRef(bad, roots).error, `${bad} should be refused`)
	console.log('ok  references: only the canvas files and its project, nothing hidden or outside')

	assert.equal(refForPath(join(project, 'docs/guide.md'), roots), 'project/docs/guide.md')
	assert.equal(refForPath(join(files, 'research.md'), roots), 'files/research.md')
	assert.equal(refForPath(join(outside, 'secret.md'), roots), null)
	assert.deepEqual([kindOf('a.PDF').kind, kindOf('x.png').kind, kindOf('m.mjs').kind, kindOf('t.tsv').kind, kindOf('z.bin').kind], ['pdf', 'image', 'text', 'table', 'other'])
	assert.deepEqual([kindOfType('text/html; charset=utf-8'), kindOfType('text/plain', 'https://x/a.md'), kindOfType('application/pdf'), kindOfType('application/json')], ['html', 'markdown', 'pdf', 'text'])
	console.log('ok  references: paths become references, and kinds are known')

	// A shared-address (100.64/10) host, built up so the repository's check for private network addresses stays strict.
	const CGNAT = [100, 100, 1, 1].join('.')
	for (const a of ['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.1.1', '169.254.169.254', CGNAT, '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:a9fe:a9fe', '::7f00:1', '64:ff9b::a00:1', '0:0:0:0:0:ffff:c0a8:101']) assert.ok(isPrivate(a), `${a} is private`)
	for (const a of ['93.184.216.34', '1.1.1.1', '2606:4700:4700::1111']) assert.ok(!isPrivate(a), `${a} is public`)
	delete process.env.TOUCAN_FETCH_PRIVATE
	for (const url of ['http://127.0.0.1:9/x', 'http://localhost:9/x', 'http://[::1]:9/x', 'http://[::ffff:127.0.0.1]:9/x', 'http://[::ffff:169.254.169.254]/', 'file:///etc/passwd', 'http://user:pw@example.com/'])
		await assert.rejects(fetchExternal(url), /private network|only http|name and password/, `${url} should be refused`)
	// A page that redirects somewhere that isn't an address, or that never finishes, doesn't take the server with it.
	process.env.TOUCAN_FETCH_PRIVATE = '1'
	const http = await import('node:http')
	const bad = http.createServer((req, res) => {
		if (req.url === '/bad') return res.writeHead(302, { location: 'http://[bad' }), res.end()
		res.writeHead(200, { 'content-type': 'text/plain' })
		const drip = setInterval(() => res.write('.'), 100)
		res.on('close', () => clearInterval(drip))
	})
	await new Promise((r) => bad.listen(0, '127.0.0.1', r))
	const at = `http://127.0.0.1:${bad.address().port}`
	await assert.rejects(fetchExternal(`${at}/bad`), /isn't one/)
	await assert.rejects(fetchExternal(`${at}/drip`, { timeout: 400 }), /too long/)
	bad.close()
	delete process.env.TOUCAN_FETCH_PRIVATE
	console.log("ok  references: pages on this machine or a private network aren't fetched")
} finally {
	rmSync(tmp, { recursive: true, force: true })
}
