// Engine-neutral plumbing every canvas tab runs: the exec relay (agent code → this tab), canvas
// scripts, and the index thumbnail. Each engine hands in its own scope: `editor` (the engine's API),
// `tl` (the engine's module) and `toucan` (helpers with the same core: summary, graph, applyGraph,
// screenshot, zoomTo, get, remove).

import { wsUrl, canvasName, token, headless } from './net'
import { getThreads, setThreads } from './threads-store'
import { setFormatId } from './formats'
import { activity, say, turn, setRunning } from './pulses'

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor

export type Scope = { editor: any; tl: any; toucan: any }

/** Connects to /ws/canvas: runs exec requests and (re)installs canvas scripts. Returns a cleanup. */
export function connectRelay(scope: Scope, setStatus: (s: string) => void) {
	let ws: WebSocket | undefined,
		closed = false
	const cleanups = new Map<string, (() => void) | null>()

	function runScripts(scripts: { name: string; code: string }[]) {
		for (const [, cleanup] of cleanups) try { cleanup?.() } catch {}
		cleanups.clear()
		for (const s of scripts) {
			try {
				const cleanup = new Function('editor', 'tl', 'toucan', s.code)(scope.editor, scope.tl, scope.toucan)
				cleanups.set(s.name, typeof cleanup === 'function' ? cleanup : null)
			} catch (e) {
				console.error(`canvas script ${s.name} failed`, e)
			}
		}
	}

	function connect() {
		ws = new WebSocket(wsUrl('/ws/canvas') + (headless && `&headless=${headless}`))
		const sock = ws
		sock.onopen = () => setStatus('live')
		sock.onclose = () => {
			setStatus('offline')
			if (!closed) setTimeout(connect, 1500)
		}
		sock.onmessage = async (ev) => {
			const msg = JSON.parse(ev.data)
			if (msg.type === 'scripts') return runScripts(msg.scripts)
			if (msg.type === 'threads') return setThreads(msg.threads)
			if (msg.type === 'format') return setFormatId(msg.format)
			// Another tab ran agent code: glow what it added or changed (agent presence, app/pulses.tsx).
			if (msg.type === 'agent-edit') return scope.toucan.pulse?.(msg.ids, msg.agent)
			// An agent is at work on this canvas: what it is doing, saying, and pointing at.
			if (msg.type === 'agent-activity') return activity(msg)
			if (msg.type === 'agent-turn') return turn(msg)
			if (msg.type === 'agent-say') {
				say({ agent: msg.agent, text: msg.text })
				return msg.keys?.length && scope.toucan.pulse?.(msg.keys, msg.agent)
			}
			if (msg.type !== 'exec') return
			sock.send(JSON.stringify({ type: 'ack', id: msg.id }))
			// One undo step per run, and a record of which shapes it added, changed or removed.
			const done = scope.toucan._track?.()
			setRunning(msg.agent)
			const finish = () => {
				const changes = done?.()
				const ids = changes ? [...changes.added, ...changes.updated].map((c: any) => c.id) : []
				if (ids.length) scope.toucan.pulse?.(ids, msg.agent)
				setRunning()
				// Don't move the canvas under someone reading or writing in a thread.
				const { active, draft } = getThreads()
				if (changes?.added.length && active === null && !draft) scope.toucan.reveal?.(changes.added.map((c: any) => c.id))
				return changes
			}
			try {
				const fn = new AsyncFunction('editor', 'tl', 'toucan', msg.code)
				const result = await fn(scope.editor, scope.tl, scope.toucan)
				sock.send(JSON.stringify({ type: 'result', id: msg.id, ok: true, result: JSON.parse(JSON.stringify(result ?? null)), changes: finish() }))
			} catch (e: any) {
				sock.send(JSON.stringify({ type: 'result', id: msg.id, ok: false, error: `${e.name}: ${e.message}`, changes: finish() }))
			}
		}
	}
	connect()
	const onFocus = () => ws?.readyState === 1 && ws.send(JSON.stringify({ type: 'focus' }))
	window.addEventListener('focus', onFocus)
	return () => {
		closed = true
		ws?.close()
		window.removeEventListener('focus', onFocus)
		for (const [, cleanup] of cleanups) try { cleanup?.() } catch {}
	}
}

/**
 * Keeps a small PNG of the canvas on the server for the index. Debounced, and only from a visible
 * tab, so a canvas open in several tabs doesn't upload the same picture from each of them.
 * `render` returns null while there is nothing (yet) to draw.
 */
export function keepThumbnail(render: () => Promise<Blob | null>, subscribe: (onChange: () => void) => () => void) {
	let timer: ReturnType<typeof setTimeout> | undefined,
		tries = 0
	const upload = async () => {
		if (document.visibilityState !== 'visible') return
		try {
			const blob = await render()
			if (!blob) return void (tries++ < 5 && schedule(3000)) // the document may still be syncing
			await fetch(`/api/canvases/${encodeURIComponent(canvasName)}/thumb`, { method: 'PUT', headers: { authorization: `Bearer ${token}`, 'content-type': 'image/png' }, body: blob })
		} catch (e) {
			console.warn('thumbnail upload failed', e)
		}
	}
	const schedule = (ms: number) => (clearTimeout(timer), (timer = setTimeout(upload, ms)))
	schedule(3000)
	const stop = subscribe(() => schedule(8000))
	return () => (clearTimeout(timer), stop())
}

/**
 * A canvas created from another one (`toucan new X --from Y`) carries a seed graph that the first
 * tab applies; tldraw needs a live editor for that (text measurement, layout).
 */
export async function applySeed(toucan: any) {
	const res = await fetch(`/api/canvases/${encodeURIComponent(canvasName)}/seed`, { headers: { authorization: `Bearer ${token}` } })
	if (res.status !== 200) return
	const tg = await res.json()
	await fetch(`/api/canvases/${encodeURIComponent(canvasName)}/seed`, { method: 'DELETE', headers: { authorization: `Bearer ${token}` } })
	const result = await toucan.applyGraph(tg, { move: true })
	toucan.zoomTo()
	console.info('applied seed graph', result)
}

export const blobToBase64 = async (blob: Blob) => {
	const buf = new Uint8Array(await blob.arrayBuffer())
	let s = ''
	for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000))
	return btoa(s)
}
