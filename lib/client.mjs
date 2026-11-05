// Talking to a running toucan server from Node: what bin/toucan.mjs uses, and what extension
// commands (`toucan-<name>` on PATH, see README) import to drive a canvas the same way.
//
//   import { connect } from 'toucan/client'
//   const t = connect({ canvas: 'my-canvas' })
//   await t.exec('return toucan.summary()')

import { existsSync, readFileSync } from 'node:fs'
import { CONFIG } from './paths.mjs'

export { CONFIG }

export function readConfig() {
	// A server on another machine or outside this container: TOUCAN_URL and TOUCAN_TOKEN say all there is to know.
	if (process.env.TOUCAN_TOKEN && process.env.TOUCAN_URL) return { token: process.env.TOUCAN_TOKEN, url: process.env.TOUCAN_URL, port: new URL(process.env.TOUCAN_URL).port }
	if (!existsSync(CONFIG)) throw new Error(`no ${CONFIG}: run \`toucan start\` on this machine, or set TOUCAN_URL and TOUCAN_TOKEN to use a server elsewhere`)
	return JSON.parse(readFileSync(CONFIG, 'utf8'))
}

/**
 * `agent` names you on the canvas (the status pill, your cursor, the glow's tag): TOUCAN_AGENT, or "agent".
 */
export function connect({ canvas = process.env.TOUCAN_CANVAS, server = process.env.TOUCAN_URL, agent = process.env.TOUCAN_AGENT } = {}) {
	const cfg = readConfig()
	const base = server ?? cfg.url

	async function call(path, init = {}, { text = false } = {}) {
		const res = await fetch(base + path, { ...init, headers: { authorization: `Bearer ${cfg.token}`, 'content-type': 'application/json' } }).catch((e) => {
			const code = e.cause?.code ?? e.message
			throw new Error(`can't reach the toucan server at ${base} (${code})${code === 'EPERM' || code === 'EACCES' ? ': a sandbox is blocking local network. Use the toucan_* MCP tools instead' : ''}`)
		})
		if (text && res.ok) return res.text()
		const data = await res.json().catch(() => ({}))
		if (!res.ok) throw new Error(`${res.status} ${data.error ?? ''}`.trim())
		return data
	}

	function need() {
		if (!canvas) throw new Error('which canvas? Pass --canvas NAME, or run `toucan init` to give this project its own')
		return encodeURIComponent(canvas)
	}

	/**
	 * Run JS in the live editor of an open tab (or the server's headless page, if it runs with
	 * --headless and no tab is open); resolves to what the code `return`s. `label` names the edit on
	 * the canvas's trail (default: the start of the code). `doing` is what people see while it runs
	 * ("reading the notes"; default: the label).
	 */
	async function exec(code, timeoutMs, label, doing) {
		const r = await call(`/api/canvases/${need()}/exec`, { method: 'POST', body: JSON.stringify({ code, timeoutMs, label, agent, doing }) })
		if (!r.ok) throw new Error(r.error)
		return r.result
	}

	/** Tell people what you are about to do; `keys` moves your cursor to those shapes. Resolves to { tabs }. */
	const say = (text, keys = []) => call(`/api/canvases/${need()}/say`, { method: 'POST', body: JSON.stringify({ agent, text, keys }) })

	return {
		cfg,
		canvas,
		call,
		exec,
		say,
		/** `/api/canvases/<canvas><sub>`; throws when no canvas was given. */
		path: (sub = '') => `/api/canvases/${need()}${sub}`,
		/** The browser link: TOUCAN_PUBLIC_HOST if set, else the address the server advertised. */
		url: (name = canvas) => `${process.env.TOUCAN_PUBLIC_HOST ? `http://${process.env.TOUCAN_PUBLIC_HOST}:${cfg.port}` : cfg.public ?? cfg.url}/${name ? `?canvas=${encodeURIComponent(name)}` : ''}`,
	}
}
