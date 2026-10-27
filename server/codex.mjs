// Chat panel backend: one `codex app-server` child (stdio JSON-RPC), one thread per canvas.
// Codex runs on the machine's ChatGPT sign-in (`codex login`); no API key is involved.
// Codex edits the canvas the same way a terminal agent does — by running bin/toucan.mjs —
// so there is one path for both. Approval requests are forwarded to the browser.

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import readline from 'node:readline'

const instructions = (canvas, engine = 'tldraw', notes = null) => `You are the agent in toucan's chat panel. The user is looking at the ${engine} canvas "${canvas}" in their browser and can also edit it by hand.
Change the canvas with the toucan CLI (read AGENTS.md first): run \`node bin/toucan.mjs --canvas ${canvas} <cmd>\`.
Inspect before you change: \`summary\` or \`exec\` to read shapes; \`screenshot\` to look. Prefer small, reversible edits and keep the user's hand edits.
For lasting new behaviour, install a canvas script (\`script put\`). Reply briefly with what you changed.${engine === 'tldraw' ? '' : `
This canvas runs ${engine}, not tldraw: in exec code \`editor\` is the ${engine} API and \`tl\` its module (see AGENTS.md). The engine-neutral path is \`graph\` (read) and \`import\` (keyed upsert of a TG/Mermaid/JSON Canvas file).`}${notes ? `
This deployment adds its own agent notes in ${notes}: read them too.` : ''}`

export class CodexChat {
	constructor({ root, port, engineOf = () => 'tldraw', data = join(root, 'canvases') }) {
		this.engineOf = engineOf
		// Deployment-specific instructions for the chat agent (extensions, house canvases): <data>/AGENTS.md.
		this.notes = join(data, 'AGENTS.md')
		this.root = root
		this.port = port
		this.proc = null
		this.seq = 0
		this.calls = new Map()
		this.threads = new Map() // canvas -> threadId
		this.sockets = new Map() // canvas -> Set<ws>
		this.history = new Map() // canvas -> recent events for late joiners
		this.approvals = new Map() // approval key -> {rpcId, canvas}
		this.turns = new Map() // canvas -> active turnId
		this.state = join(root, '.toucan', 'threads.json')
		if (existsSync(this.state)) this.saved = JSON.parse(readFileSync(this.state, 'utf8'))
		else this.saved = {}
	}

	attach(ws, canvas) {
		if (!canvas) return ws.close()
		if (!this.sockets.has(canvas)) this.sockets.set(canvas, new Set())
		this.sockets.get(canvas).add(ws)
		ws.send(JSON.stringify({ type: 'history', events: this.history.get(canvas) ?? [] }))
		ws.on('close', () => this.sockets.get(canvas).delete(ws))
		ws.on('message', async (raw) => {
			const msg = JSON.parse(raw)
			try {
				if (msg.type === 'send') await this.send(canvas, msg.text)
				else if (msg.type === 'new') await this.reset(canvas)
				else if (msg.type === 'interrupt') await this.interrupt(canvas)
				else if (msg.type === 'approve') this.answer(msg.key, msg.decision)
			} catch (e) {
				this.emit(canvas, { type: 'error', message: String(e.message ?? e) })
			}
		})
	}

	emit(canvas, event, keep = true) {
		if (keep) {
			const h = this.history.get(canvas) ?? []
			h.push(event)
			this.history.set(canvas, h.slice(-400))
		}
		for (const ws of this.sockets.get(canvas) ?? []) ws.send(JSON.stringify(event))
	}

	// ---- JSON-RPC over stdio -------------------------------------------------
	start() {
		if (this.proc) return this.ready
		this.proc = spawn('codex', ['app-server'], { cwd: this.root, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env } })
		this.proc.stderr.on('data', (d) => process.stderr.write(`[codex] ${d}`))
		this.proc.on('exit', (code) => {
			console.error(`[codex] app-server exited (${code})`)
			this.proc = null
			this.threads.clear()
			for (const [, c] of this.calls) c.reject(new Error('codex app-server exited'))
			this.calls.clear()
		})
		readline.createInterface({ input: this.proc.stdout }).on('line', (line) => this.onLine(line))
		this.ready = (async () => {
			await this.call('initialize', { clientInfo: { name: 'toucan', title: 'toucan', version: '0.1.0' }, capabilities: null })
			this.notify('initialized', {})
		})()
		return this.ready
	}

	call(method, params) {
		const id = ++this.seq
		return new Promise((resolve, reject) => {
			this.calls.set(id, { resolve, reject })
			this.proc.stdin.write(JSON.stringify({ method, id, params }) + '\n')
		})
	}
	notify(method, params) {
		this.proc.stdin.write(JSON.stringify({ method, params }) + '\n')
	}
	reply(id, result) {
		this.proc?.stdin.write(JSON.stringify({ id, result }) + '\n')
	}

	onLine(line) {
		let msg
		try {
			msg = JSON.parse(line)
		} catch {
			return
		}
		if (msg.id !== undefined && !msg.method) {
			const c = this.calls.get(msg.id)
			this.calls.delete(msg.id)
			if (c) msg.error ? c.reject(new Error(msg.error.message)) : c.resolve(msg.result)
			return
		}
		const p = msg.params ?? {}
		const canvas = this.canvasFor(p.threadId ?? p.turn?.threadId)
		if (msg.id !== undefined) return this.onServerRequest(msg, canvas)
		if (!canvas) return
		switch (msg.method) {
			// Streaming deltas go to open tabs only; the completed item carries the final text.
			case 'item/agentMessage/delta':
				return this.emit(canvas, { type: 'delta', itemId: p.itemId, text: p.delta }, false)
			case 'item/reasoning/summaryTextDelta':
				return this.emit(canvas, { type: 'reasoning', itemId: p.itemId, index: p.summaryIndex, text: p.delta }, false)
			case 'item/commandExecution/outputDelta':
				return this.emit(canvas, { type: 'output', itemId: p.itemId, text: p.delta }, false)
			case 'item/fileChange/patchUpdated':
				return this.emit(canvas, { type: 'item', phase: 'updated', item: slim({ type: 'fileChange', id: p.itemId, status: 'inProgress', changes: p.changes }) }, false)
			case 'turn/plan/updated': {
				// Only the latest plan of a turn is worth replaying to late joiners.
				const h = this.history.get(canvas)
				if (h) this.history.set(canvas, h.filter((e) => !(e.type === 'plan' && e.turnId === p.turnId)))
				return this.emit(canvas, { type: 'plan', turnId: p.turnId, explanation: p.explanation, steps: p.plan })
			}
			case 'item/started':
			case 'item/completed':
				return this.emit(canvas, { type: 'item', phase: msg.method.split('/')[1], item: slim(p.item) })
			case 'turn/started':
				this.turns.set(canvas, p.turn?.id)
				return this.emit(canvas, { type: 'turn', status: 'inProgress', turnId: p.turn?.id })
			case 'turn/completed':
				this.turns.delete(canvas)
				return this.emit(canvas, { type: 'turn', status: p.turn?.status, error: p.turn?.error?.message })
			case 'error':
				return this.emit(canvas, { type: 'error', message: p.error?.message ?? JSON.stringify(p) })
		}
	}

	onServerRequest(msg, canvas) {
		const approvals = ['item/commandExecution/requestApproval', 'item/fileChange/requestApproval']
		if (!canvas || !approvals.includes(msg.method)) {
			// Anything we don't render is declined rather than left hanging.
			return this.reply(msg.id, { decision: 'decline' })
		}
		const key = `a${msg.id}`
		this.approvals.set(key, { rpcId: msg.id, canvas })
		const p = msg.params
		this.emit(canvas, { type: 'approval', key, kind: msg.method.split('/')[1], itemId: p.itemId, command: p.command, cwd: p.cwd, reason: p.reason })
	}

	answer(key, decision) {
		const a = this.approvals.get(key)
		if (!a) return
		this.approvals.delete(key)
		this.reply(a.rpcId, { decision: decision === 'accept' ? 'accept' : 'decline' })
		this.emit(a.canvas, { type: 'approved', key, decision })
	}

	canvasFor(threadId) {
		for (const [c, t] of this.threads) if (t === threadId) return c
		return null
	}

	// ---- threads ---------------------------------------------------------------
	async thread(canvas) {
		await this.start()
		if (this.threads.has(canvas)) return this.threads.get(canvas)
		const opts = { cwd: this.root, approvalPolicy: 'on-request', developerInstructions: instructions(canvas, this.engineOf(canvas), existsSync(this.notes) ? this.notes : null), serviceName: 'toucan' }
		let res
		if (this.saved[canvas]) {
			try {
				res = await this.call('thread/resume', { threadId: this.saved[canvas], ...opts })
			} catch {
				res = null
			}
		}
		res ??= await this.call('thread/start', { ...opts, sandbox: 'workspace-write' })
		const id = res.thread.id
		this.threads.set(canvas, id)
		this.saved[canvas] = id
		mkdirSync(join(this.root, '.toucan'), { recursive: true })
		writeFileSync(this.state, JSON.stringify(this.saved, null, 2))
		return id
	}

	async send(canvas, text) {
		const threadId = await this.thread(canvas)
		this.emit(canvas, { type: 'user', text })
		await this.call('turn/start', {
			threadId,
			input: [{ type: 'text', text, text_elements: [] }],
			cwd: this.root,
			summary: 'auto', // reasoning summaries feed the chat panel's "Thinking" line
			// The CLI talks to this server over loopback, so the sandbox needs network.
			sandboxPolicy: { type: 'workspaceWrite', writableRoots: [this.root], networkAccess: true, excludeTmpdirEnvVar: false, excludeSlashTmp: false },
		})
	}

	async interrupt(canvas) {
		const threadId = this.threads.get(canvas), turnId = this.turns.get(canvas)
		if (threadId && turnId) await this.call('turn/interrupt', { threadId, turnId }).catch(() => {})
	}

	async reset(canvas) {
		this.threads.delete(canvas)
		delete this.saved[canvas]
		this.history.set(canvas, [])
		this.emit(canvas, { type: 'history', events: [] }, false)
	}
}

// Keep item payloads small for the browser; command output can be large.
function slim(item) {
	if (!item) return item
	const out = { id: item.id, type: item.type }
	if (item.type === 'agentMessage') out.text = item.text
	if (item.type === 'userMessage') return null
	if (item.type === 'commandExecution') Object.assign(out, { command: item.command, status: item.status, exitCode: item.exitCode, durationMs: item.durationMs, output: item.aggregatedOutput?.slice(-3000) })
	if (item.type === 'fileChange') {
		out.status = item.status
		out.paths = item.changes?.map((c) => c.path)
		out.changes = item.changes?.map((c) => ({ path: c.path, kind: c.kind?.type, diff: c.diff?.length > 6000 ? c.diff.slice(0, 6000) + '\n…' : c.diff }))
	}
	if (item.type === 'reasoning') out.summary = item.summary
	if (item.type === 'plan') out.text = item.text
	if (item.type === 'mcpToolCall') Object.assign(out, { server: item.server, tool: item.tool, status: item.status })
	if (item.type === 'dynamicToolCall') Object.assign(out, { tool: item.tool, status: item.status })
	if (item.type === 'webSearch') Object.assign(out, { query: item.query })
	return out
}
