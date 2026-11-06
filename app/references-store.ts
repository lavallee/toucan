// The References panel's state, outside React because the app bar, the details card, the relay (an agent's `toucan show`)
// and the panel itself all open things in it. See server/references.mjs for what a reference is.

import { useSyncExternalStore } from 'react'
import { canvasName, token } from './net'

export type Opened = { ref: string; by?: string }
type State = { open: boolean; stack: Opened[]; wide: boolean }
let state: State = { open: false, stack: [], wide: false }
const listeners = new Set<() => void>()
const set = (patch: Partial<State>) => {
	state = { ...state, ...patch }
	listeners.forEach((f) => f())
}
export const useReferences = () => useSyncExternalStore((f) => (listeners.add(f), () => listeners.delete(f)), () => state)
export const getReferences = () => state

/** Opens a reference in the panel; `by` names the agent that asked. Opening the one already showing does nothing. */
export function openReference(ref: string, by?: string) {
	if (state.open && state.stack.at(-1)?.ref === ref) return
	set({ open: true, stack: [...state.stack, { ref, by }].slice(-50) })
}
export const showList = () => set({ open: true, stack: [] })
export const back = () => set({ stack: state.stack.slice(0, -1) })
export const close = () => set({ open: false })
export const toggle = () => set({ open: !state.open })
export const setWide = (wide: boolean) => set({ wide })

export const isWeb = (ref: string) => /^https?:\/\//i.test(ref)

/** A reference's name for a heading: the file's name, or the page's host and path. */
export function nameOf(ref: string) {
	if (isWeb(ref)) {
		try {
			const u = new URL(ref)
			return `${u.host}${u.pathname === '/' ? '' : decodeURIComponent(u.pathname)}`
		} catch {
			return ref
		}
	}
	return ref.split('/').at(-1) || ref
}

/** Where a link inside a document goes: another reference, resolved against the one it's in, or null for an anchor. */
export function resolveLink(base: string, href: string): string | null {
	const h = href.trim()
	if (!h || h.startsWith('#')) return null
	if (isWeb(h)) return h
	if (/^[a-z][a-z0-9+.-]*:/i.test(h)) return null // mailto:, javascript: and the like aren't references
	if (isWeb(base)) {
		try {
			return new URL(h, base).href
		} catch {
			return null
		}
	}
	const [root, ...path] = base.split('/')
	const clean = h.split('#')[0].split('?')[0]
	if (!clean) return null
	const parts = clean.startsWith('/') ? [] : path.slice(0, -1)
	for (const p of clean.split('/')) {
		if (!p || p === '.') continue
		if (p === '..') parts.pop()
		else parts.push(safeDecode(p))
	}
	return [root, ...parts].join('/')
}

function safeDecode(s: string) {
	try {
		return decodeURIComponent(s)
	} catch {
		return s
	}
}

/** A web address's host, or the address itself if it isn't a well-formed one. */
export function hostOf(ref: string) {
	try {
		return new URL(ref).host
	} catch {
		return ref
	}
}

export type Loaded = { kind: string; type: string; url: string; blob: Blob; status?: number }

/** Fetches a reference through the server, with the token in a header rather than a URL someone could see. */
export async function loadReference(ref: string, signal?: AbortSignal): Promise<Loaded> {
	const res = await fetch(`/api/canvases/${encodeURIComponent(canvasName)}/reference?ref=${encodeURIComponent(ref)}`, { headers: { authorization: `Bearer ${token}` }, signal })
	if (!res.ok) {
		let message = `${res.status}`
		try {
			message = (await res.json()).error ?? message
		} catch {}
		throw new Error(message)
	}
	const url = res.headers.get('x-toucan-url')
	return {
		kind: res.headers.get('x-toucan-kind') ?? 'other',
		type: res.headers.get('content-type') ?? '',
		url: url ? decodeURI(url) : ref,
		status: Number(res.headers.get('x-toucan-status') ?? 200),
		blob: await res.blob(),
	}
}

export type Listing = { roots: { id: string; label: string }[]; files: { ref: string; root: string; path: string; kind: string; size: number }[]; cut: boolean }
export async function listReferences(): Promise<Listing> {
	const res = await fetch(`/api/canvases/${encodeURIComponent(canvasName)}/references`, { headers: { authorization: `Bearer ${token}` } })
	if (!res.ok) throw new Error(`${res.status}`)
	return res.json()
}
