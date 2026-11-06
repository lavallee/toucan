// The names a server answers to (lib/hosts.mjs): addresses, localhost, the machine's own names, its public URL and
// TOUCAN_HOSTS; anything else is refused, over HTTP and WebSocket alike. And the links it gives out use its public URL.
import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import http from 'node:http'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { hostCheck, hostName, parsePublicUrl } from '../lib/hosts.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

assert.deepEqual(['toucan.example:8893', '[::1]:8893', '::1', '10.0.0.2:80', 'Toucan.Example.'].map(hostName), ['toucan.example', '::1', '::1', '10.0.0.2', 'toucan.example.'])
assert.equal(parsePublicUrl('toucan.example'), 'http://toucan.example')
assert.equal(parsePublicUrl('https://toucan.example/'), 'https://toucan.example')
for (const bad of ['ftp://x', 'http://x/path', 'http://']) assert.throws(() => parsePublicUrl(bad))

const ok = hostCheck({ hosts: ['extra.test', '.corp.test'], publicUrl: 'http://toucan.example', publicHost: 'box', machine: 'box' })
for (const h of ['127.0.0.1:8893', '[::1]:8893', '192.0.2.7', 'localhost:8893', 'app.localhost', 'box:8893', 'box.example.ts.net', 'box.local', 'toucan.example', 'TOUCAN.EXAMPLE:80', 'extra.test', 'a.corp.test', undefined])
	assert.ok(ok(h), `${h} should be allowed`)
for (const h of ['evil.example', 'toucan.example.evil.test', 'corp.test.evil', 'boxx', 'notbox.local', 'extra.test.evil']) assert.ok(!ok(h), `${h} should be refused`)
assert.ok(hostCheck({ hosts: ['*'] })('anything.at.all'), '* turns the check off')
console.log('ok  hosts: addresses, localhost, the machine, the public URL and TOUCAN_HOSTS; nothing else')

// A real server, at a public URL with an extra domain.
const home = mkdtempSync(join(tmpdir(), 'toucan-hosts-home-')), data = mkdtempSync(join(tmpdir(), 'toucan-hosts-data-'))
const port = await new Promise((r) => {
	const s = createServer().listen(0, '127.0.0.1', () => (r(s.address().port), s.close()))
})
const env = { ...process.env, HOME: home, TOUCAN_PUBLIC_URL: 'http://toucan.example', TOUCAN_HOSTS: '.corp.test' }
for (const k of ['TOUCAN_URL', 'TOUCAN_CANVAS', 'TOUCAN_PUBLIC_HOST']) delete env[k]
const server = spawn(process.execPath, [join(ROOT, 'server/index.mjs'), '--port', String(port), '--data', data], { env, stdio: ['ignore', 'pipe', 'pipe'] })
let log = ''
server.stdout.on('data', (d) => (log += d))
server.stderr.on('data', (d) => (log += d))
try {
	for (let i = 0; i < 50 && !log.includes('listening'); i++) await new Promise((r) => setTimeout(r, 100))
	const token = JSON.parse(readFileSync(join(home, '.config/toucan/server.json'), 'utf8')).token
	const get = (host, path = '/api/health', headers = {}) =>
		new Promise((done, fail) => {
			const req = http.request({ host: '127.0.0.1', port, path, headers: { host, authorization: `Bearer ${token}`, ...headers } }, (res) => {
				let body = ''
				res.on('data', (c) => (body += c))
				res.on('end', () => done({ status: res.statusCode, body }))
			})
			req.on('error', fail)
			req.end()
		})
	assert.equal((await get('toucan.example')).status, 200)
	assert.equal((await get(`127.0.0.1:${port}`)).status, 200)
	assert.equal((await get('docs.corp.test')).status, 200)
	const refused = await get('rebound.evil.test')
	assert.equal(refused.status, 421)
	assert.match(refused.body, /TOUCAN_HOSTS=rebound\.evil\.test/)
	assert.equal((await get('rebound.evil.test', '/')).status, 421, 'the app itself is refused too')
	const upgrade = await get('rebound.evil.test', '/ws/canvas?canvas=x', { connection: 'Upgrade', upgrade: 'websocket', 'sec-websocket-version': '13', 'sec-websocket-key': Buffer.from('the sample nonce').toString('base64') })
	assert.equal(upgrade.status, 421, 'and so is a WebSocket')
	console.log('ok  hosts: a server answers its public URL and listed names, and refuses others over HTTP and WebSocket')

	assert.equal(JSON.parse(readFileSync(join(home, '.config/toucan/server.json'), 'utf8')).public, 'http://toucan.example')
	const out = (await promisify(execFile)(process.execPath, [join(ROOT, 'bin/toucan.mjs'), 'url', '--canvas', 'plan'], { env: { ...env, TOUCAN_PUBLIC_URL: '' } })).stdout
	assert.match(out, /^http:\/\/toucan\.example\/\?canvas=plan/m, `toucan url gave ${out}`)
	console.log('ok  hosts: links and sign-in use the public URL')
} catch (e) {
	console.error(log.slice(-1500))
	throw e
} finally {
	server.kill()
	await new Promise((r) => setTimeout(r, 200))
	rmSync(home, { recursive: true, force: true })
	rmSync(data, { recursive: true, force: true })
}
