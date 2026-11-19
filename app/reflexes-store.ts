// The canvas's reflexes as this tab knows them (server/reflexes.mjs). The server pushes the whole status over the canvas
// socket whenever it changes.
import { useSyncExternalStore } from 'react'

export type ReflexNode = {
	name: string
	about: string
	when: string
	do: { routine?: string; args?: unknown; code?: string; tell?: boolean } | null
	under: string | null
	status: 'on' | 'watching' | 'off' | 'paused'
	by?: string
	starter?: string
	stats: { acted?: number; done?: number; failed?: number; undone?: number; would?: number; told?: number }
	last?: { t: string; ok: boolean; summary?: string; error?: string; on?: string[] }
	tried?: { verdict: string; t: string; staged?: boolean }
}
export type ReflexAsk = { id: number; node: string; why: string; on?: string[]; text?: string; t: string; woke?: boolean; prompt: string }
export type ReflexStarter = { name: string; about: string; under?: string; does: string; added: boolean }
export type ReflexStatus = { nodes: ReflexNode[]; asks: ReflexAsk[]; wake: boolean; resting?: string; starters: ReflexStarter[] }

let state: ReflexStatus = { nodes: [], asks: [], wake: false, starters: [] }
const listeners = new Set<() => void>()
export const setReflexes = (next: ReflexStatus) => ((state = next), listeners.forEach((f) => f()))
export const useReflexes = () => useSyncExternalStore((f) => (listeners.add(f), () => listeners.delete(f)), () => state)
