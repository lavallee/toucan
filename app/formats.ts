// The canvas's format, as this tab knows it (server/formats.mjs says what each one means).
import { useSyncExternalStore } from 'react'
import { api, canvasName } from './net'

export type Format = { id: string; label: string; description: string; walk: 'edges' | 'lanes' }

let current: Format | null = null
let known: Format[] = []
const listeners = new Set<() => void>()
const changed = () => listeners.forEach((f) => f())
export const getFormat = () => current
export const useFormat = () => useSyncExternalStore((f) => (listeners.add(f), () => listeners.delete(f)), getFormat)
export const formatList = () => known

export function setFormatId(id: string | null | undefined) {
	current = known.find((f) => f.id === id) ?? null
	changed()
}
export async function loadFormats(id: string | null | undefined) {
	const r = await api('/api/formats')
	known = r.formats
	setFormatId(id)
}
export const chooseFormat = (id: string | null) => api(`/api/canvases/${encodeURIComponent(canvasName)}/meta`, { method: 'PATCH', body: JSON.stringify({ format: id ?? '' }) })
