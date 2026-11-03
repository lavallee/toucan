// The agent eval: common requests, sent to the chat agent on blank canvases, with what it drew scored by the same measure as the
// templates. It needs a Codex sign-in and spends real usage, so it isn't part of npm test. Pictures and a report land in evals/out/.
//
//   npm run build && node scripts/eval-agent.mjs [--only a,b] [--mode fast|thorough]
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { homedir, platform, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { WebSocket } from 'ws'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const only = args.includes('--only') ? args[args.indexOf('--only') + 1].split(',') : null
const mode = args.includes('--mode') ? args[args.indexOf('--mode') + 1] : 'fast'
const OUT = join(ROOT, 'evals/out')
mkdirSync(OUT, { recursive: true })
const requests = JSON.parse(readFileSync(join(ROOT, 'evals/requests.json'), 'utf8')).filter((r) => !only || only.includes(r.id))
const home = mkdtempSync(join(tmpdir(), 'toucan-agent-home-')), data = mkdtempSync(join(tmpdir(), 'toucan-agent-data-'))
const port = await new Promise((r) => {
	const s = createServer().listen(0, '127.0.0.1', () => (r(s.address().port), s.close()))
})
const env = { ...process.env, HOME: home, TOUCAN_HEADLESS_MAX: '8', CODEX_HOME: process.env.CODEX_HOME ?? join(homedir(), '.codex'), PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH ?? join(homedir(), platform() === 'darwin' ? 'Library/Caches/ms-playwright' : '.cache/ms-playwright') }
const server = spawn(process.execPath, [join(ROOT, 'server/index.mjs'), '--port', String(port), '--data', data, '--headless'], { cwd: ROOT, env, stdio: 'ignore' })
await new Promise((r) => setTimeout(r, 1000))
const run = promisify(execFile)
const toucan = async (...a) => (await run(process.execPath, [join(ROOT, 'bin/toucan.mjs'), ...a], { env, maxBuffer: 64 << 20 })).stdout
const token = JSON.parse(readFileSync(join(home, '.config/toucan/server.json'), 'utf8')).token

async function ask(canvas, text) {
	const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/chat?canvas=${canvas}&token=${token}`)
	await new Promise((r) => ws.on('open', r))
	const seen = { commands: [], reply: '', status: 'timeout' }
	const done = new Promise((res) => {
		ws.on('message', (raw) => {
			const e = JSON.parse(raw)
			if (e.type === 'item' && e.phase === 'completed' && e.item?.type === 'commandExecution') (seen.commands.push(String(e.item.command).slice(0, 400)), (seen.drew ||= /toucan\.mjs\S*\s+(--canvas\s+\S+\s+)?draw\b/.test(e.item.command)))
			if (e.type === 'item' && e.phase === 'completed' && e.item?.type === 'agentMessage') seen.reply = e.item.text
			if (e.type === 'approval') ws.send(JSON.stringify({ type: 'approve', key: e.key, decision: 'decline' }))
			if (e.type === 'turn' && e.status && e.status !== 'inProgress') (seen.status = e.status), res()
			if (e.type === 'error') (seen.error = e.message), res()
		})
		setTimeout(res, 240000)
	})
	ws.send(JSON.stringify({ type: 'send', text, mode }))
	await done
	ws.close()
	return seen
}

const results = []
try {
	const queue = [...requests]
	await Promise.all(
		Array.from({ length: 3 }, async () => {
			for (let r; (r = queue.shift()); ) {
			const canvas = `ask-${r.id}`
			await toucan('new', canvas, '--title', r.id)
			await toucan('--canvas', canvas, 'exec', '-e', 'return 1') // opens the headless page, so the agent doesn't wait for it
			const t0 = Date.now()
			const seen = await ask(canvas, r.ask)
			const seconds = +((Date.now() - t0) / 1000).toFixed(1)
			const { findings, ...m } = JSON.parse(await toucan('--canvas', canvas, 'exec', '-e', 'return toucan.measure()'))
			await toucan('--canvas', canvas, 'screenshot', join(OUT, `ask-${r.id}.png`), '--max', '1400').catch(() => {})
			const drew = !!seen.drew
			results.push({ id: r.id, ask: r.ask, score: m.score, seconds, commands: seen.commands.length, usedDraw: drew, status: seen.status, boxes: m.boxes, arrows: m.arrows, findings: [...new Set(findings.map((f) => f.kind))], run: seen.commands, reply: seen.reply.slice(0, 200), textAtFit: m.textAtFit })
			}
		}),
	)
} finally {
	server.kill()
	await new Promise((r) => setTimeout(r, 300))
	rmSync(home, { recursive: true, force: true })
	rmSync(data, { recursive: true, force: true })
}
results.sort((a, b) => a.id.localeCompare(b.id))
writeFileSync(join(OUT, 'agent.json'), JSON.stringify(results, null, 1) + '\n')
for (const r of results) console.log(`${String(r.score).padStart(3)}  ${r.id.padEnd(10)} ${String(r.seconds).padStart(6)}s  ${r.commands} commands  draw:${r.usedDraw ? 'yes' : 'no '}  ${r.boxes} boxes  ${r.status}  ${r.findings.join('; ')}`)
console.log(`\nmean ${Math.round(results.reduce((s, r) => s + r.score, 0) / results.length)} over ${results.length} requests, in ${Math.round(results.reduce((s, r) => s + r.seconds, 0) / results.length)}s on average`)
