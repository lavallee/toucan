// Agent presence: shapes an agent just added or changed glow briefly in every open tab, with a small
// tag naming the agent, so edits that arrive through the exec relay are as visible as a collaborator's.
// The server broadcasts `agent-edit` (ids) after each exec that changed something; the relay calls pulse().
//
// Agent at work: while an agent is busy on the canvas (an exec running, a chat turn in progress, or a
// moment after its last call), every tab shows it: a status pill naming the agent and what it is doing,
// a soft ring around the canvas, and an agent cursor that moves to the shapes it last touched or pointed
// at (`toucan say TEXT --at KEYS`). The server broadcasts `agent-activity`, `agent-say` and `agent-turn`.

import { Fragment, useEffect, useReducer, useSyncExternalStore } from 'react'

type Pulse = { key: number; ids: string[]; via: string }
type Box = { x: number; y: number; w: number; h: number }
type Point = { x: number; y: number }

export const PULSE_MS = 2600
let list: Pulse[] = []
let seq = 0
const subs = new Set<() => void>()
const emit = () => subs.forEach((f) => f())

/** The agent whose code this tab is running now (set by the relay), so `toucan.pulse()` is signed. */
let running: string | undefined
export const setRunning = (name?: string) => void (running = name)

/** Make these shapes glow for a moment in this tab. The agent's cursor moves to them, too. */
export function pulse(ids: string[], via = running ?? 'agent') {
	if (!ids?.length) return
	const p = { key: ++seq, ids: [...new Set(ids)], via }
	list = [...list, p]
	emit()
	aim(via, p.ids)
	setTimeout(() => {
		list = list.filter((x) => x !== p)
		emit()
	}, PULSE_MS)
}

export const usePulses = () =>
	useSyncExternalStore(
		(f) => (subs.add(f), () => subs.delete(f)),
		() => list,
	)

/**
 * The halos for one pulse, in the overlay's coordinates: a glowing outline around each box, and a glowing
 * trace along each arrow (`lines`, so a diagonal arrow doesn't light up its whole bounding box).
 * `scale` keeps strokes the same size on screen.
 */
export function PulseBoxes({ pulse: p, boxes, lines = [], scale = 1 }: { pulse: Pulse; boxes: Box[]; lines?: Point[][]; scale?: number }) {
	if (!boxes.length && !lines.length) return null
	const pad = 6 / scale
	const pts = [...boxes.flatMap((b) => [{ x: b.x, y: b.y }]), ...lines.flat()]
	const left = Math.min(...pts.map((b) => b.x)), top = Math.min(...pts.map((b) => b.y))
	return (
		<Fragment>
			{lines.length > 0 && (
				<svg className="toucan-pulse-line" style={{ position: 'absolute', left: 0, top: 0, width: 1, height: 1, overflow: 'visible', pointerEvents: 'none' }}>
					{lines.map((l, i) => (
						<polyline key={i} points={l.map((q) => `${q.x},${q.y}`).join(' ')} fill="none" stroke="rgb(139 92 246)" strokeOpacity={0.55} strokeWidth={8 / scale} strokeLinecap="round" strokeLinejoin="round" />
					))}
				</svg>
			)}
			{boxes.map((b, i) => (
				<div key={i} className="toucan-pulse" style={{ left: b.x - pad, top: b.y - pad, width: b.w + 2 * pad, height: b.h + 2 * pad, ['--pulse-w' as string]: `${3 / scale}px`, borderRadius: 8 / scale }} />
			))}
			<div className="toucan-pulse-tag" style={{ left: left - pad, top: top - pad, transform: `translateY(-100%) scale(${1 / scale})`, transformOrigin: 'bottom left' }}>
				{p.via}
			</div>
		</Fragment>
	)
}

/** Excalidraw's halos and agent cursors, drawn in page space under the view's scroll and zoom. */
export function ExcalidrawPulses({ api }: { api: any }) {
	const pulses = usePulses()
	const atWork = useAgents()
	const [, redraw] = useReducer((n: number) => n + 1, 0)
	useEffect(() => {
		if (!api) return
		const offScroll = api.onScrollChange(redraw)
		const offChange = api.onChange(() => (list.length || agents.size) && redraw())
		return () => (offScroll(), offChange())
	}, [api])
	if (!api || (!pulses.length && !atWork.length)) return null
	const { scrollX, scrollY, zoom } = api.getAppState()
	const els = new Map(api.getSceneElements().map((e: any) => [e.id, e]))
	const box = (e: any): Box => ({ x: e.x, y: e.y, w: e.width, h: e.height })
	const line = (e: any): Point[] => e.points.map(([px, py]: number[]) => ({ x: e.x + px, y: e.y + py }))
	const isLine = (e: any) => e.type === 'arrow' || e.type === 'line'
	const found = (ids: string[]) => ids.map((id) => els.get(id)).filter(Boolean) as any[]
	return (
		<div style={{ position: 'absolute', inset: 0, zIndex: 3, overflow: 'hidden', pointerEvents: 'none' }}>
			<div style={{ position: 'absolute', left: 0, top: 0, transformOrigin: '0 0', transform: `scale(${zoom.value}) translate(${scrollX}px, ${scrollY}px)` }}>
				{pulses.map((p) => {
					const f = found(p.ids)
					return <PulseBoxes key={p.key} pulse={p} boxes={f.filter((e) => !isLine(e)).map(box)} lines={f.filter(isLine).map(line)} scale={zoom.value} />
				})}
				{atWork.map((a) => {
					// The first box it names or adds; an arrow only if it touched nothing else.
					const f = found(a.target), e = f.find((e) => !isLine(e)) ?? f[0]
					return <AgentCursor key={a.name} agent={a} box={!e ? null : isLine(e) ? union(line(e).map((q) => ({ ...q, w: 0, h: 0 }))) : box(e)} scale={zoom.value} />
				})}
			</div>
		</div>
	)
}

// ---- agent at work ------------------------------------------------------------

/** How long an agent still counts as at work after its last call: the gap while it thinks. */
export const LINGER_MS = 8000
/** How long a `toucan say` line stays up, unless the agent says something else. */
export const SAY_MS = 30000

export type Agent = {
	name: string
	/** What its current or last call does ("reading the notes", "importing plan.mmd"). */
	doing: string
	/** Its own words from `toucan say`, and when it said them. */
	said?: string
	saidAt?: number
	/** Calls in flight, and the conversations (chat, comment threads) with a turn running. */
	running: number
	turns: string[]
	at: number
	/** Shapes its cursor sits on: the ones it last changed or pointed at. */
	target: string[]
	targetAt: number
}

let agents = new Map<string, Agent>()
const agentSubs = new Set<() => void>()
let tick: ReturnType<typeof setInterval> | undefined

// Bounded, so a call or turn whose end never arrives (a dropped socket, a crashed chat) can't pin the pill.
const isAtWork = (a: Agent, now = Date.now()) => (a.running > 0 && now - a.at < 130_000) || (a.turns.length > 0 && now - a.at < 600_000) || now - a.at < LINGER_MS

function update(name: string, f: (a: Agent) => Partial<Agent>) {
	const now = Date.now()
	const a = agents.get(name) ?? { name, doing: 'working', running: 0, turns: [], at: now, target: [], targetAt: 0 }
	agents = new Map(agents).set(name, { ...a, ...f(a), at: now })
	agentSubs.forEach((s) => s())
	// Re-check now and then, so an agent that went quiet fades out.
	tick ??= setInterval(() => {
		const now = Date.now()
		const live = new Map([...agents].filter(([, a]) => isAtWork(a, now)))
		if (live.size !== agents.size) (agents = live), agentSubs.forEach((s) => s())
		if (!agents.size) (clearInterval(tick), (tick = undefined))
	}, 500)
}

function aim(name: string, ids: string[]) {
	update(name, () => ({ target: ids, targetAt: Date.now() }))
}

/** A call from an agent started or finished (the server's `agent-activity`). */
export function activity({ agent = 'agent', doing, phase }: { agent?: string; doing?: string; phase: 'start' | 'end' }) {
	update(agent, (a) => ({ ...(doing && { doing }), running: Math.max(0, a.running + (phase === 'start' ? 1 : -1)) }))
}

/** The agent said what it is about to do (`toucan say`); `ids` are the shapes it means. */
export function say({ agent = 'agent', text, ids = [] }: { agent?: string; text: string; ids?: string[] }) {
	update(agent, () => ({ said: text || undefined, saidAt: Date.now(), ...(ids.length && { target: ids, targetAt: Date.now() }) }))
}

/** A turn started or ended in one of the chat agent's conversations (the chat panel, a comment thread). */
export function turn({ agent = 'agent', key = '', active }: { agent?: string; key?: string; active: boolean }) {
	update(agent, (a) => ({ turns: active ? [...new Set([...a.turns, key])] : a.turns.filter((k) => k !== key), ...(active && { doing: 'thinking' }) }))
}

/** Agents at work on this canvas now. */
export function useAgents(): Agent[] {
	const map = useSyncExternalStore(
		(f) => (agentSubs.add(f), () => agentSubs.delete(f)),
		() => agents,
	)
	return [...map.values()].filter((a) => isAtWork(a))
}

/** One line for the pill: its own words while fresh, else what its call does. */
export const lineFor = (a: Agent) => (a.said && Date.now() - (a.saidAt ?? 0) < SAY_MS ? a.said : a.doing)

/**
 * An agent's cursor, in the overlay's coordinates: a pointer at the lower left of the shape it is on
 * (the first it named with `say --at`, or the first its last edit added or changed), with its name and
 * what it is doing. It glides when the agent moves on.
 */
export function AgentCursor({ agent, box, scale = 1 }: { agent: Agent; box: Box | null; scale?: number }) {
	if (!box) return null
	return (
		// Tip just inside the lower-left of the shape, so the tag hangs below it rather than off to the side.
		<div className="toucan-agent-cursor" style={{ left: box.x + Math.min(28 / scale, box.w / 4), top: box.y + box.h - 8 / scale, transform: `scale(${1 / scale})` }}>
			<svg width="18" height="20" viewBox="0 0 18 20" aria-hidden>
				<path d="M1.5 1.5 L1.5 16 L5.5 12.2 L8.4 18.5 L11 17.3 L8.2 11.2 L13.8 11.2 Z" fill="rgb(139 92 246)" stroke="white" strokeWidth="1.5" strokeLinejoin="round" />
			</svg>
			<span className="toucan-agent-cursor-tag">
				<b>{agent.name}</b> {lineFor(agent)}
			</span>
		</div>
	)
}

/** The bounding box of several boxes. */
export function union(boxes: Box[]): Box | null {
	if (!boxes.length) return null
	const x = Math.min(...boxes.map((b) => b.x)), y = Math.min(...boxes.map((b) => b.y))
	return { x, y, w: Math.max(...boxes.map((b) => b.x + b.w)) - x, h: Math.max(...boxes.map((b) => b.y + b.h)) - y }
}

/** Above the canvas (any engine): who is at work and on what, and a soft ring round the canvas. */
export function AgentStatus({ top = 52 }: { top?: number }) {
	const list = useAgents()
	if (!list.length) return null
	return (
		<>
			<div className="toucan-agent-ring" aria-hidden />
			<div className="toucan-ui toucan-agent-status" style={{ top }} role="status" aria-live="polite">
				{list.map((a) => (
					<span key={a.name} className="flex items-center gap-2">
						<span className="toucan-agent-dot" aria-hidden />
						<b className="font-semibold text-foreground">{a.name}</b>
						<span className="max-w-[48ch] truncate">{lineFor(a)}</span>
					</span>
				))}
			</div>
		</>
	)
}
