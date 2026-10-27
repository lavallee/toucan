// Talking to a running toucan server from Node: what bin/toucan.mjs uses, and what extension
// commands (`toucan-<name>` on PATH, see README) import to drive a canvas the same way.
//
//   import { connect } from 'toucan/client'
//   const t = connect({ canvas: 'my-canvas' })
//   await t.exec('return toucan.summary()')

import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const CONFIG = join(homedir(), '.config/toucan/server.json')

export function readConfig() {
	if (!existsSync(CONFIG)) throw new Error(`no ${CONFIG} — is the toucan server running on this machine?`)
	return JSON.parse(readFileSync(CONFIG, 'utf8'))
}

export function connect({ canvas = process.env.TOUCAN_CANVAS, server = process.env.TOUCAN_URL } = {}) {
	const cfg = readConfig()
	const base = server ?? cfg.url

	async function call(path, init = {}, { text = false } = {}) {
		const res = await fetch(base + path, { ...init, headers: { authorization: `Bearer ${cfg.token}`, 'content-type': 'application/json' } })
		if (text && res.ok) return res.text()
		const data = await res.json().catch(() => ({}))
		if (!res.ok) throw new Error(`${res.status} ${data.error ?? ''}`.trim())
		return data
	}

	function need() {
		if (!canvas) throw new Error('which canvas? pass --canvas NAME or set TOUCAN_CANVAS')
		return encodeURIComponent(canvas)
	}

	/** Run JS in the live editor of an open tab; resolves to what the code `return`s. */
	async function exec(code, timeoutMs) {
		const r = await call(`/api/canvases/${need()}/exec`, { method: 'POST', body: JSON.stringify({ code, timeoutMs }) })
		if (!r.ok) throw new Error(r.error)
		return r.result
	}

	return {
		cfg,
		canvas,
		call,
		exec,
		/** `/api/canvases/<canvas><sub>`; throws when no canvas was given. */
		path: (sub = '') => `/api/canvases/${need()}${sub}`,
		/** The browser link: TOUCAN_PUBLIC_HOST if set, else the address the server advertised. */
		url: (name = canvas) => `${process.env.TOUCAN_PUBLIC_HOST ? `http://${process.env.TOUCAN_PUBLIC_HOST}:${cfg.port}` : cfg.public ?? cfg.url}/${name ? `?canvas=${encodeURIComponent(name)}` : ''}`,
	}
}
