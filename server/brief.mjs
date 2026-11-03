// What the chat needs to act without looking first. A brief of the canvas goes with each message, so the
// agent's first move can be the edit rather than a read; and some messages need no agent at all.

import { FORMATS } from '../lib/tg.mjs'

const MAX_NODES = 200, MAX_EDGES = 200, MAX_TEXT = 60
const clip = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT)
const box = (b) => (b ? ` @${Math.round(b.x)},${Math.round(b.y)} ${Math.round(b.w)}x${Math.round(b.h)}` : '')

/**
 * A toucan graph, plus what the tab reports, as compact lines for the model. `live` is what a person's tab said
 * about selection and notes; without it, selection is unknown rather than empty, and the brief says so.
 */
export function formatBrief(tg, live = null, threads = []) {
	const groups = tg.groups ?? [], nodes = tg.nodes ?? [], edges = tg.edges ?? [], skipped = tg.skipped?.length ?? 0
	const lines = [`<canvas_brief>The canvas as this message was sent (keys, text, position and size). Trust it instead of reading the canvas again.`]
	if (!nodes.length && !groups.length && !skipped) lines.push('The canvas is empty.')
	for (const g of groups.slice(0, 60)) lines.push(`frame ${g.key}: ${clip(g.label)}${box(g.box)}`)
	for (const n of nodes.slice(0, MAX_NODES)) lines.push(`box ${n.key}${n.group ? ` in ${n.group}` : ''}: ${clip(n.text)}${box(n.box)}`)
	if (nodes.length > MAX_NODES) lines.push(`… and ${nodes.length - MAX_NODES} more boxes; use \`summary\` if you need them.`)
	for (const e of edges.slice(0, MAX_EDGES)) lines.push(`arrow ${e.from} -> ${e.to}${e.label ? `: ${clip(e.label)}` : ''}`)
	if (edges.length > MAX_EDGES) lines.push(`… and ${edges.length - MAX_EDGES} more arrows.`)
	if (skipped) lines.push(`Also ${skipped} other shape${skipped === 1 ? '' : 's'} not listed here (sketches, images, loose lines or arrows): run \`summary\` before placing anything near them.`)
	if (live) {
		const others = (live.others ?? []).filter((o) => o.shapes?.length).map((o) => `${o.user || 'someone'}: ${o.shapes.slice(0, 20).join(', ')}`)
		if (live.selected?.length) lines.push(`Selected now by the person you're talking to ("this", "these"): ${live.selected.slice(0, 40).join(', ')}`)
		else lines.push('Nothing is selected in their tab.')
		if (others.length) lines.push(`Selected by others: ${others.join('; ')}`)
		if (live.openNotes) lines.push(`${live.openNotes} open sticky note${live.openNotes === 1 ? '' : 's'}; \`notes\` lists them.`)
	} else lines.push("Selection unknown (no answer from a person's tab): run `selection` if they say \"this\" or \"these\".")
	for (const t of threads.slice(0, 15)) lines.push(`Open comment thread ${t}`)
	if (threads.length > 15) lines.push(`… and ${threads.length - 15} more open threads; \`threads\` lists them.`)
	lines.push('</canvas_brief>')
	return lines.join('\n')
}

/**
 * A message that can go straight onto the canvas with no agent: `/routine-name`, or nothing but a Mermaid
 * flowchart (fenced or not) that parses cleanly. Anything else, including prose that happens to start
 * "graph LR" or a flowchart with a request after it, is for the agent.
 */
export function parseDirect(text) {
	const t = String(text ?? '').trim()
	const slash = /^\/([a-z0-9][a-z0-9-_]*)$/i.exec(t)
	if (slash) return { routine: slash[1] }
	const fenced = /^```(?:mermaid)?[ \t]*\n([\s\S]*?)\n```$/.exec(t)
	const src = (fenced ? fenced[1] : t).trim()
	if (!/^(flowchart|graph)[ \t]+(TD|TB|BT|LR|RL)\b/i.test(src)) return null
	const tg = FORMATS.mermaid.import(src)
	return tg.nodes?.length && !tg.warnings?.length ? { graph: tg } : null
}
