// What on a canvas points at reference material: a shape's meta.refs, web addresses in its text or details, and links
// people pasted (tldraw bookmarks, an Excalidraw element's link). Shared by both engines' helpers.

const URL_RE = /\bhttps?:\/\/[^\s<>"'`)\]]+[^\s<>"'`)\].,;:!?]/gi

/** Web addresses in some text, in order, without repeats. */
export const urlsIn = (text) => [...new Set(String(text ?? '').match(URL_RE) ?? [])]

/** A shape's meta.refs, which agents set: strings, or { ref, label }. Synced documents can't be taken on trust. */
export function refsFromMeta(meta) {
	const list = Array.isArray(meta?.refs) ? meta.refs : typeof meta?.refs === 'string' ? [meta.refs] : []
	return list.flatMap((r) => {
		const ref = typeof r === 'string' ? r : typeof r?.ref === 'string' ? r.ref : typeof r?.href === 'string' ? r.href : null
		if (!ref || ref.length > 2000) return []
		return [{ ref, ...(typeof r?.label === 'string' && { label: r.label.slice(0, 200) }) }]
	})
}

/** Everything a shape points at, as { ref, label? }: its refs first, then addresses in its details and text. */
export function refsOfShape({ meta, text, link }) {
	const out = refsFromMeta(meta)
	const seen = new Set(out.map((r) => r.ref))
	for (const ref of [link, ...urlsIn(meta?.detail), ...urlsIn(text)].filter((r) => typeof r === 'string' && /^https?:\/\//i.test(r))) {
		if (!seen.has(ref)) seen.add(ref), out.push({ ref })
	}
	return out
}
