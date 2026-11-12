// Whether this tab is running an older toucan page than the server now serves: it heard one build when it loaded and
// another after reconnecting (the server was upgraded and restarted). app/UpdateNotice.tsx offers the reload.
import { useSyncExternalStore } from 'react'

let loaded: string | null = null
let stale = false
const listeners = new Set<() => void>()

/** The server's build, as told on each (re)connect. True while this tab is out of date (so each new socket says so). */
export function heardBuild(id: string | null): boolean {
	if (!id) return false
	if (loaded === null) {
		loaded = id
		return false
	}
	if (id === loaded) return false
	if (!stale) {
		stale = true
		for (const f of listeners) f()
	}
	return true
}

export const useStale = () =>
	useSyncExternalStore(
		(f) => (listeners.add(f), () => listeners.delete(f)),
		() => stale,
	)
