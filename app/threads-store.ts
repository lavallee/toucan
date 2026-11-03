// Comment threads as this tab knows them (the server pushes the whole list over /ws/canvas whenever any
// change), plus what the tab is doing with them. Lives outside React because the app bar, the panel and the layer
// over the canvas all need it, and they don't share a parent that knows the engine.

import { useSyncExternalStore } from 'react'
import { api, canvasName } from './net'

export type Box = { x: number; y: number; w: number; h: number }
export type Anchor = { shapes?: string[]; box?: Box; region?: Box; page?: string }
export type Author = { kind: 'person' | 'agent'; name: string }
export type Message = { author: Author; text: string; t: string }
export type Thread = {
	id: number
	anchor: Anchor
	status: 'open' | 'closed'
	created: string
	closed?: { by: Author; t: string }
	messages: Message[]
	working?: boolean
	approval?: { key: string; command?: string; reason?: string; kind?: string }
	source?: { note?: string }
}
export type Ask = 'none' | 'agent' | 'chat'

type State = { threads: Thread[]; active: number | null; placing: boolean; panel: boolean; showClosed: boolean; draft: Anchor | null }
let state: State = { threads: [], active: null, placing: false, panel: false, showClosed: false, draft: null }
const listeners = new Set<() => void>()
export function update(patch: Partial<State>) {
	state = { ...state, ...patch }
	listeners.forEach((f) => f())
}
export const setThreads = (threads: Thread[]) => update({ threads })
export const getThreads = () => state
export const useThreads = () => useSyncExternalStore((f) => (listeners.add(f), () => listeners.delete(f)), getThreads)

// The layer over the canvas registers how to reach a thread on this engine; the panel just asks.
let reveal: (t: Thread) => void = () => {}
export const onReveal = (f: (t: Thread) => void) => (reveal = f)
export function openThread(t: Thread) {
	update({ active: t.id, draft: null, placing: false })
	reveal(t)
}

/** The Comment button: on what's selected if anything is, or else let the person pick a spot. */
export function startComment(toucan: any) {
	if (state.placing || state.draft) return update({ placing: false, draft: null })
	const keys: string[] = (toucan?.selection?.().here ?? []).map((s: any) => s.key)
	if (keys.length) update({ draft: { shapes: keys, box: toucan.boundsOf(keys) ?? undefined, page: toucan.pageId?.() }, active: null })
	else update({ placing: true, active: null })
}

/** Whose move is it? Shown on pins and in the list. */
export function stateOf(t: Thread): 'closed' | 'working' | 'yours' | 'open' {
	if (t.status === 'closed') return 'closed'
	if (t.working || t.approval) return 'working'
	return t.messages.at(-1)?.author.kind === 'agent' ? 'yours' : 'open'
}

// Who's speaking, kept per browser and shared with tldraw's own presence name.
export const myName = () => localStorage.getItem('toucan.name') || ''
export const me = (): Author => ({ kind: 'person', name: myName() || 'Someone' })
export const setMyName = (name: string) => localStorage.setItem('toucan.name', name)

// Where a message goes: people only, this thread's own agent, or the main chat. Remembered per browser.
export const lastAsk = (): Ask => {
	const v = localStorage.getItem('toucan.threadAsk')
	return v === 'none' || v === 'chat' ? v : 'agent'
}
export const rememberAsk = (ask: Ask) => localStorage.setItem('toucan.threadAsk', ask)
const mode = () => (localStorage.getItem('toucan.chatMode') === 'thorough' ? 'thorough' : 'fast')

const base = `/api/canvases/${encodeURIComponent(canvasName)}/threads`
const post = (path: string, body: object = {}) => api(`${base}${path}`, { method: 'POST', body: JSON.stringify({ author: me(), ...body }) })
export const createThread = (anchor: Anchor, text: string, ask: Ask) => post('', { anchor, text, ask, mode: mode() })
export const replyTo = (id: number, text: string, ask: Ask) => post(`/${id}/messages`, { text, ask, mode: mode() })
export const closeThread = (id: number) => post(`/${id}/close`)
export const reopenThread = (id: number) => post(`/${id}/reopen`)
export const stopThread = (id: number) => post(`/${id}/stop`)
export const routeThread = (id: number, ask: Ask) => post(`/${id}/route`, { ask, mode: mode() })
export const answerApproval = (id: number, key: string, decision: 'accept' | 'decline') => post(`/${id}/approve`, { key, decision })
export const adoptNotes = () => post('/adopt-notes')
export const notesToAdopt = () => api(base).then((r) => r.notes as number)
