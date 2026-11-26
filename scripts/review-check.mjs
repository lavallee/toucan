import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { homedir, platform, tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { promisify } from 'node:util'

const root = new URL('../', import.meta.url)
const temp = mkdtempSync(join(tmpdir(), 'toucan-review-'))
const socket = createServer().listen(0, '127.0.0.1')
await once(socket, 'listening')
const origin = `http://127.0.0.1:${socket.address().port}`
await new Promise((done) => socket.close(done))

const env = { ...process.env }
for (const key of Object.keys(env)) if (key.startsWith('TOUCAN_')) delete env[key]
Object.assign(env, {
	HOME: temp, XDG_CONFIG_HOME: join(temp, '.config'), TOUCAN_URL: origin,
	PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH ?? join(homedir(), platform() === 'darwin' ? 'Library/Caches/ms-playwright' : '.cache/ms-playwright'),
})
const protocol = 'toucan.review/1'
const image = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVR4nGP8z8Dwn4GBgYGJgQEKAB4RAgEOBQLmAAAAAElFTkSuQmCC'
const file = join(temp, 'shot.png')
writeFileSync(file, Buffer.from(image, 'base64'))
let server, browser, token
const run = promisify(execFile)
const command = async (...args) => (await run(process.execPath, ['bin/toucan.mjs', ...args], { cwd: root, env })).stdout.trim()
const cli = async (...args) => JSON.parse(await command(...args))
const base = (canvas) => `/api/canvases/${canvas}`
const api = (path, body, auth = true) => fetch(origin + path, {
	method: body === undefined ? 'GET' : 'POST',
	headers: { 'content-type': 'application/json', ...(auth && { authorization: `Bearer ${token}` }) },
	body: body === undefined ? undefined : JSON.stringify(body),
})

async function start() {
	const config = join(temp, '.config/toucan/server.json')
	server = spawn(process.execPath, ['server/index.mjs', '--port', new URL(origin).port, '--data', join(temp, 'data')], { cwd: root, env, stdio: ['ignore', 'ignore', 'inherit'] })
	for (let i = 0; i < 100; i++) {
		try {
			token = JSON.parse(readFileSync(config)).token
			if ((await api('/api/health')).ok) return
		} catch {}
		await sleep(50)
	}
	throw new Error('test server did not come up')
}

async function stop() {
	if (!server || server.exitCode !== null || server.signalCode !== null) return
	const exited = once(server, 'exit')
	server.kill()
	await exited
}

const url = (canvas) => base(canvas) + '/review'
const write = async (canvas, mutation, input, status = 200) => {
	const res = await api(url(canvas), { protocol, mutation, ...input })
	const out = await res.json()
	assert.equal(res.status, status, JSON.stringify(out))
	return out
}
const list = async (canvas, producer) => (await api(url(canvas) + (producer ? `?producer=${producer}` : ''))).json()
const post = (producer, previous = null) => ({ op: 'post', artifact: 'landing', title: 'Landing page', producer, image, previous })

try {
	await start()
	await command('new', 'review-test')
	await command('new', 'other', '--engine', 'excalidraw')
	assert.equal((await api(url('missing'))).status, 404)
	assert.equal((await api(url('review-test'), undefined, false)).status, 401)
	const cliPost = () => cli('--canvas', 'review-test', 'review', 'post', 'landing', file, '--title', 'Landing page', '--producer', 'session-one', '--mutation', 'post-1')
	const { revision: first } = await cliPost()
	assert.deepEqual((await cliPost()).revision, first)
	await write('review-test', 'post-1', { ...post('session-one'), title: 'Changed' }, 409)
	await write('review-test', 'post-bad', { ...post('session-one', first.id), image: Buffer.from('<html>active content</html>').toString('base64') }, 400)
	assert.equal((await api(`${url('review-test')}/${first.id}/image`, undefined, false)).status, 401)
	assert.equal((await api(`${url('other')}/${first.id}/image`)).status, 404)
	const output = join(temp, 'download.png')
	await command('--canvas', 'review-test', 'review', 'image', first.id, output)
	assert.equal(readFileSync(output).toString('base64'), image)
	const imageResponse = await api(`${url('review-test')}/${first.id}/image`)
	assert.equal(imageResponse.headers.get('content-type'), 'image/png')
	assert.equal(Buffer.from(await imageResponse.arrayBuffer()).toString('base64'), image)
	const pin = { op: 'pin', revision: first.id, pin: { x: 0.25, y: 0.75 }, author: 'Reviewer', text: 'Space the controls farther apart.' }
	await write('review-test', 'bad-pin', { ...pin, pin: { x: -1, y: 0.5 } }, 400)
	const { note } = await write('review-test', 'pin-1', pin)
	assert.deepEqual((await write('review-test', 'pin-1', pin)).note, note)
	const { revision: second } = await write('review-test', 'post-2', post('session-two', first.id))
	assert.equal(second.number, 2)
	await write('review-test', 'stale', post('session-one', first.id), 409)
	const { revision: third } = await write('review-test', 'post-3', post('session-one', second.id))
	const answer = { op: 'reply', note: note.id, producer: 'session-one', replacement: third.id, text: 'Controls spaced apart.' }
	await write('review-test', 'misrouted', { ...answer, producer: 'session-two' }, 403)
	await write('review-test', 'bad-replacement', { ...answer, replacement: second.id }, 400)

	await stop()
	await start()
	assert.deepEqual((await list('review-test', 'session-one')).inbox, [{ note, revision: first }])
	assert.deepEqual((await list('review-test', 'session-two')).inbox, [])
	const cliAnswer = () => cli('--canvas', 'review-test', 'review', 'reply', note.id, answer.text, '--producer', answer.producer, '--replacement', third.id, '--mutation', 'reply-1')
	const answered = await cliAnswer()
	assert.deepEqual(await cliAnswer(), answered)
	assert.equal(answered.note.reply.replacement, third.id)
	assert.deepEqual((await list('review-test', 'session-one')).inbox, [])
	await write('review-test', 'reply-duplicate', answer, 409)
	await write('review-test', 'close-1', { op: 'close', note: note.id })
	assert.ok((await list('review-test')).notes[0].closedAt)
	assert.equal((await cliAnswer()).note.closedAt, null, 'reply retries return the original receipt')

	await command('new', 'archive-me')
	const { revision: archiveRevision } = await write('archive-me', 'archived-post', post('session-one'))
	const contenders = await Promise.all(['race-1', 'race-2'].map((mutation) => api(url('archive-me'), {
		protocol, mutation, ...post('session-one', archiveRevision.id),
	})))
	assert.deepEqual(contenders.map((res) => res.status).sort(), [200, 409])
	assert.equal((await list('archive-me')).revisions.length, 2)
	const archiveResponse = await api(base('archive-me') + '/archive', {})
	assert.equal(archiveResponse.status, 200)
	const archived = await archiveResponse.json()
	assert.ok(readFileSync(join(archived.archivedTo, 'archive-me.review', 'log.json')).length)
	assert.equal((await api(url('archive-me'))).status, 404)
	await command('new', 'archive-me')
	assert.deepEqual((await list('archive-me')).revisions, [])
	console.log('ok  review HTTP + CLI: immutable revisions, isolated inboxes, pinned feedback, replies, retries, restart, and archive')

	if (process.argv.includes('--browser')) {
		process.env.PLAYWRIGHT_BROWSERS_PATH = env.PLAYWRIGHT_BROWSERS_PATH
		const { chromium } = await import('playwright-core')
		browser = await chromium.launch(process.env.REVIEW_BROWSER ? { executablePath: process.env.REVIEW_BROWSER } : {})
		for (const canvas of ['review-test', 'other']) {
			const other = canvas === 'other'
			const { revision } = other ? await write(canvas, 'first', post('session-one')) : { revision: third }
			const page = await browser.newPage({ viewport: { width: other ? 440 : 1360, height: 900 } })
			const errors = []
			page.on('pageerror', (err) => errors.push(err.message))
			await page.goto(`${origin}/?canvas=${canvas}#token=${token}`)
			await page.getByRole('button', { name: 'Review', exact: true }).click()
			const dialog = page.getByRole('dialog', { name: 'Screenshot review' })
			const shot = dialog.getByRole('button', { name: 'Place feedback pin on screenshot' })
			await shot.locator('img').evaluate((img) => img.decode())
			await shot.press('Enter')
			await dialog.getByLabel('Feedback', { exact: true }).fill('Pin from keyboard')
			await dialog.getByRole('button', { name: 'Post feedback' }).click()
			await dialog.getByText('Pin from keyboard').waitFor()
			assert.equal((await list(canvas, 'session-one')).inbox[0].revision.id, revision.id)
			if (!other) {
				await dialog.getByLabel('Revision').selectOption(first.id)
				await dialog.getByRole('button', { name: 'View revised screenshot' }).click()
				await dialog.getByText('Before · v1', { exact: true }).waitFor()
				await dialog.getByText('After · v3', { exact: true }).waitFor()
			}
			await page.keyboard.press('Escape')
			await dialog.waitFor({ state: 'hidden' })
			assert.deepEqual(errors, [])
			await page.close()
		}
		console.log('ok  Chromium: review, keyboard pin, revision comparison, and close on both canvas engines')
	}
} finally {
	await browser?.close()
	await stop()
	rmSync(temp, { recursive: true, force: true })
}
