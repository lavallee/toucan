// The names a toucan server answers to, and the address it gives out in links.
//
// A server bound to every interface can be reached by names nobody chose for it, and a web page can point a name of its
// own at it (DNS rebinding) and try its luck. So the server answers to an IP address, localhost, this machine's name
// (and names under it, like Tailscale's `machine.example.ts.net` or `machine.local`), the host of its public URL, and
// the names a deployment lists in TOUCAN_HOSTS. Anything else is told which setting would let it in.
//
// TOUCAN_PUBLIC_URL is the address people reach the server at, when that isn't this machine's name and port: a name
// behind a reverse proxy, say. Links, `toucan open` and `toucan url` use it, so signing in happens where people browse.

import { isIP } from 'node:net'

/** A public URL as an origin with no trailing slash, or an error. */
export function parsePublicUrl(raw) {
	if (!raw) return null
	let u
	try {
		u = new URL(String(raw).includes('://') ? raw : `http://${raw}`)
	} catch {
		throw new Error(`TOUCAN_PUBLIC_URL isn't an address: ${raw}`)
	}
	if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error(`TOUCAN_PUBLIC_URL must be http or https, not ${u.protocol}`)
	if (u.pathname !== '/' || u.search || u.hash) throw new Error(`TOUCAN_PUBLIC_URL is an origin like http://toucan.example, without a path: ${raw}`)
	return u.origin
}

/** A Host header's name, lowercased, without its port or IPv6 brackets. */
export function hostName(header) {
	const h = String(header ?? '').trim().toLowerCase()
	if (h.startsWith('[')) return h.slice(1, h.indexOf(']'))
	const colon = h.lastIndexOf(':')
	return colon > -1 && h.indexOf(':') === colon ? h.slice(0, colon) : h
}

/**
 * A check of Host headers. `hosts` are extra names, from TOUCAN_HOSTS: `toucan.example` exactly, or `.example` for any
 * name under it. `*` turns the check off, for a deployment that does its own.
 */
export function hostCheck({ hosts = [], publicUrl = null, publicHost = null, machine = '' } = {}) {
	const list = hosts.map((h) => h.trim().toLowerCase()).filter(Boolean)
	if (list.includes('*')) return () => true
	const exact = new Set(['localhost', machine.toLowerCase(), publicHost?.toLowerCase(), publicUrl && new URL(publicUrl).hostname.toLowerCase()].filter(Boolean))
	const suffixes = list.filter((h) => h.startsWith('.'))
	for (const h of list) if (!h.startsWith('.')) exact.add(h)
	const self = machine.toLowerCase()
	return (header) => {
		if (header === undefined || header === '') return true // not a browser: browsers always send one
		const name = hostName(header).replace(/\.$/, '')
		if (isIP(name)) return true // an address can't be rebound
		if (exact.has(name) || name.endsWith('.localhost')) return true
		if (self && name.startsWith(`${self}.`)) return true
		return suffixes.some((s) => name.endsWith(s))
	}
}

/** What to tell someone at a name toucan doesn't answer to. */
export const refusal = (header) =>
	`toucan doesn't answer to ${hostName(header) || 'that name'}. If that's where people reach this server, start it with TOUCAN_HOSTS=${hostName(header)} (several, comma-separated, or .example.com for every name under it), or TOUCAN_PUBLIC_URL=http://${hostName(header)} to make it the address toucan gives out.\n`
