// Token handling: the sign-in link carries #token=…; it is kept in localStorage and
// stripped from the address bar.
const hash = new URLSearchParams(location.hash.slice(1))
if (hash.get('token')) {
	localStorage.setItem('toucan.token', hash.get('token'))
	history.replaceState(null, '', location.pathname + location.search)
}
export const token = localStorage.getItem('toucan.token') ?? ''
// No ?canvas= means the index of canvases.
export const canvasName = new URLSearchParams(location.search).get('canvas') ?? ''

export async function api(path: string, init: RequestInit = {}) {
	const res = await fetch(path, { ...init, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...init.headers } })
	if (!res.ok) throw new Error(`${res.status} ${await res.text()}`)
	return res.json()
}

export function wsUrl(path: string) {
	const proto = location.protocol === 'https:' ? 'wss' : 'ws'
	return `${proto}://${location.host}${path}?canvas=${encodeURIComponent(canvasName)}&token=${encodeURIComponent(token)}`
}
