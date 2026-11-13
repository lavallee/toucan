// The plan this canvas is bound to, as this tab knows it (server/plan.mjs says what a status holds). The server pushes a
// new status over the canvas socket whenever it changes; the items themselves are fetched when something needs them.
import { useEffect, useSyncExternalStore } from 'react'
import { api, canvasName } from './net'

export type PlanOption = { id: string; label: string; color?: string }
export type PlanField = { id: string; label: string; type: 'text' | 'option' | 'options' | 'date' | 'number' | 'bool'; writable: boolean; options?: PlanOption[] }
export type PlanView = { id: string; kind: string; title?: string; groupBy?: string; [option: string]: unknown }
export type PlanProblem = { id: string; t: string; kind: string; text: string; item?: string; title?: string }
export type PlanStatus = {
	bound: boolean
	source?: { name: string; ref: string; title: string; readonly: boolean }
	state?: 'synced' | 'syncing' | 'waiting' | 'problem'
	/** Do the views on the canvas show the plan as it now is? False while a redraw waits for a page, or is on its way. */
	drawn?: boolean
	error?: string
	cursor?: string | number | null
	syncedAt?: string | null
	items?: number
	views?: PlanView[]
	fields?: PlanField[]
	problems?: PlanProblem[]
}
export type PlanItem = { id: string; version?: string | number; title?: string; [field: string]: unknown }

export const planUrl = (rest = '') => `/api/canvases/${encodeURIComponent(canvasName)}/plan${rest}`

/** What a failed call said, without the status code and JSON around it. */
export function messageOf(e: any): string {
	const text = String(e?.message ?? e).replace(/^\d{3} /, '')
	try {
		return JSON.parse(text).error ?? text
	} catch {
		return text
	}
}

let plan: PlanStatus = { bound: false }
let pushed = false
const listeners = new Set<() => void>()
const changed = () => listeners.forEach((f) => f())
const subscribe = (f: () => void) => (listeners.add(f), () => listeners.delete(f))

export const getPlan = () => plan
export const usePlan = () => useSyncExternalStore(subscribe, getPlan)
export function setPlan(next: PlanStatus | null | undefined) {
	pushed = true
	plan = next?.bound ? next : { bound: false }
	changed()
}

// Asked once, so the bar is right before the first push; a push that got there first wins.
if (canvasName) api(planUrl()).then((s) => !pushed && setPlan(s), () => {})

// ---- the items, for the details card ------------------------------------------------------------------------------------
let items: Map<string, PlanItem> | null = null
let itemsFor = ''
let loading = ''
// A sync or a write moves one of these, and then the items are worth reading again.
const stamp = () => (plan.bound ? `${plan.cursor ?? ''}|${plan.syncedAt ?? ''}|${plan.items ?? 0}` : '')

export function loadItems() {
	const want = stamp()
	if (!want || want === itemsFor || want === loading) return
	loading = want
	api(planUrl('/items')).then(
		(r) => {
			if (loading !== want) return
			items = new Map((r.items ?? []).map((it: PlanItem) => [it.id, it]))
			itemsFor = want
			loading = ''
			changed()
		},
		() => loading === want && (loading = ''),
	)
}
const getItems = () => items
/** The plan's items by id, or null until they've been read. Only fetches while `wanted`. */
export function usePlanItems(wanted: boolean) {
	const status = usePlan()
	const all = useSyncExternalStore(subscribe, getItems)
	useEffect(() => {
		if (wanted) loadItems()
	}, [wanted, status])
	return status.bound ? all : null
}

/** Sets one field of one item upstream. Throws with the source's message if it was refused. */
export async function writeField(id: string, field: string, value: unknown) {
	const r = await api(planUrl('/write'), { method: 'POST', body: JSON.stringify({ changes: [{ op: 'update', id, set: { [field]: value } }] }) })
	const result = r.results?.[0]
	if (r.plan) setPlan(r.plan)
	if (result && !result.ok) throw new Error(result.message ?? result.error ?? 'The change was refused.')
	// Show the new value straight away; the next read of the items confirms it.
	if (items && (result?.item || items.has(id))) {
		items = new Map(items).set(id, result?.item ?? { ...items.get(id)!, [field]: value })
		changed()
	}
}
