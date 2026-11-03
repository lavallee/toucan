// What the chat needs to act without looking first. A brief of the canvas goes with each message, so the
// agent's first move can be the edit rather than a read; and some messages need no agent at all.

const MAX_NODES = 200, MAX_EDGES = 200, MAX_TEXT = 60
const clip = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT)
const box = (b) => (b ? ` @${Math.round(b.x)},${Math.round(b.y)} ${Math.round(b.w)}x${Math.round(b.h)}` : '')

/** A toucan graph, plus what people have selected and left in notes, as compact lines for the model. */
export function formatBrief(tg, { selected = [], openNotes = 0 } = {}) {
	const groups = tg.groups ?? [], nodes = tg.nodes ?? [], edges = tg.edges ?? []
	const lines = [`<canvas_brief>The canvas as this message was sent (keys, text, position and size). Trust it instead of reading the canvas again.`]
	if (!nodes.length && !groups.length) lines.push('The canvas is empty.')
	for (const g of groups.slice(0, 60)) lines.push(`frame ${g.key}: ${clip(g.text ?? g.name)}${box(g.box)}`)
	for (const n of nodes.slice(0, MAX_NODES)) lines.push(`box ${n.key}${n.group ? ` in ${n.group}` : ''}: ${clip(n.text)}${box(n.box)}`)
	if (nodes.length > MAX_NODES) lines.push(`… and ${nodes.length - MAX_NODES} more boxes; use \`summary\` if you need them.`)
	for (const e of edges.slice(0, MAX_EDGES)) lines.push(`arrow ${e.from} -> ${e.to}${e.label ? `: ${clip(e.label)}` : ''}`)
	if (edges.length > MAX_EDGES) lines.push(`… and ${edges.length - MAX_EDGES} more arrows.`)
	if (selected.length) lines.push(`Selected now ("this", "these"): ${selected.slice(0, 40).join(', ')}`)
	if (openNotes) lines.push(`${openNotes} open sticky note${openNotes === 1 ? '' : 's'}; \`notes\` lists them.`)
	lines.push('</canvas_brief>')
	return lines.join('\n')
}

/**
 * A message that can go straight onto the canvas with no agent: `/routine-name`, or nothing but a Mermaid
 * flowchart (fenced or not). Anything else, including a flowchart with words around it, is for the agent.
 */
export function parseDirect(text) {
	const t = String(text ?? '').trim()
	const slash = /^\/([a-z0-9][a-z0-9-_]*)$/i.exec(t)
	if (slash) return { routine: slash[1] }
	const fenced = /^```(?:mermaid)?[ \t]*\n([\s\S]*?)\n```$/.exec(t)
	const src = (fenced ? fenced[1] : t).trim()
	if (/^(flowchart|graph)[ \t]+(TD|TB|BT|LR|RL)\b/i.test(src)) return { mermaid: src }
	return null
}
