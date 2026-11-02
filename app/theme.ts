// Appearance preferences, per browser: the colour theme (system, light or dark) and the lettering on
// tldraw canvases (clean or handwritten). `.dark` on <html> drives toucan's own UI; each engine follows
// useAppearance() in its own way.

import { useSyncExternalStore } from 'react'

export type Theme = 'system' | 'light' | 'dark'
export type Lettering = 'clean' | 'handwritten'

const read = <T extends string>(key: string, allowed: readonly T[], fallback: T): T => {
	try {
		const v = localStorage.getItem(key) as T
		return allowed.includes(v) ? v : fallback
	} catch {
		return fallback
	}
}
const THEMES = ['system', 'light', 'dark'] as const
const LETTERINGS = ['clean', 'handwritten'] as const
const system = matchMedia('(prefers-color-scheme: dark)')
const listeners = new Set<() => void>()

let state = compute()
function compute() {
	const theme = read('toucan.theme', THEMES, 'system')
	return { theme, dark: theme === 'dark' || (theme === 'system' && system.matches), lettering: read('toucan.lettering', LETTERINGS, 'clean') }
}
function refresh() {
	const next = compute()
	if (next.theme === state.theme && next.dark === state.dark && next.lettering === state.lettering) return
	state = next
	document.documentElement.classList.toggle('dark', state.dark)
	listeners.forEach((f) => f())
}
document.documentElement.classList.toggle('dark', state.dark)
system.addEventListener('change', refresh)
window.addEventListener('storage', refresh) // another tab changed it

export const getAppearance = () => state
export function useAppearance() {
	return useSyncExternalStore((f) => (listeners.add(f), () => listeners.delete(f)), getAppearance)
}
export function setTheme(theme: Theme) {
	localStorage.setItem('toucan.theme', theme)
	refresh()
}
export function setLettering(lettering: Lettering) {
	localStorage.setItem('toucan.lettering', lettering)
	refresh()
}
