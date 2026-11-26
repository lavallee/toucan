// What state a part is in, shown by colour, line and word: live (the default look), being built, in trial, planned, retiring.
// One vocabulary for the `map` layout (lib/layouts.mjs) and for Mermaid classes on import (lib/tg.mjs), so `A:::planned` and a
// tile's `"status": "planned"` look the same and are read back the same, from `meta.status`.
//
// The vocabulary, and showing a state by word as well as by colour, come from open-diagram by Luke Deasy
// (https://github.com/lukendeasy/open-diagram, MIT). No code of open-diagram is used.

export const STATUSES = {
	live: { label: 'Live', color: 'black', dash: 'solid' },
	building: { label: 'Being built', color: 'orange', dash: 'dashed' },
	trial: { label: 'In trial', color: 'violet', dash: 'dashed' },
	planned: { label: 'Planned', color: 'grey', dash: 'dotted' },
	retiring: { label: 'Retiring', color: 'red', dash: 'solid' },
}

/** The style and meta a status gives a box, or null for a name that isn't one. */
export function statusLook(name) {
	const s = STATUSES[String(name ?? '').toLowerCase()]
	return s ? { style: { color: s.color, dash: s.dash }, meta: { status: String(name).toLowerCase() } } : null
}
