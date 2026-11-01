// Agent presence: shapes an agent just added or changed glow briefly in every open tab, with a small
// "agent" tag, so edits that arrive through the exec relay are as visible as a collaborator's cursor.
// The server broadcasts `agent-edit` (ids) after each exec that changed something; the relay calls pulse().

import { Fragment, useEffect, useReducer, useSyncExternalStore } from 'react'

type Pulse = { key: number; ids: string[]; via: string }
type Box = { x: number; y: number; w: number; h: number }

export const PULSE_MS = 2600
let list: Pulse[] = []
let seq = 0
const subs = new Set<() => void>()
const emit = () => subs.forEach((f) => f())

/** Make these shapes glow for a moment in this tab. */
export function pulse(ids: string[], via = 'agent') {
	if (!ids?.length) return
	const p = { key: ++seq, ids: [...new Set(ids)], via }
	list = [...list, p]
	emit()
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

/** The halos for one pulse, given each shape's box in the overlay's coordinates. `scale` keeps the stroke the same on screen. */
export function PulseBoxes({ pulse: p, boxes, scale = 1 }: { pulse: Pulse; boxes: Box[]; scale?: number }) {
	if (!boxes.length) return null
	const pad = 6 / scale
	const left = Math.min(...boxes.map((b) => b.x)), top = Math.min(...boxes.map((b) => b.y))
	return (
		<Fragment>
			{boxes.map((b, i) => (
				<div key={i} className="toucan-pulse" style={{ left: b.x - pad, top: b.y - pad, width: b.w + 2 * pad, height: b.h + 2 * pad, ['--pulse-w' as string]: `${3 / scale}px`, borderRadius: 8 / scale }} />
			))}
			<div className="toucan-pulse-tag" style={{ left: left - pad, top: top - pad, transform: `translateY(-100%) scale(${1 / scale})`, transformOrigin: 'bottom left' }}>
				{p.via}
			</div>
		</Fragment>
	)
}

/** Excalidraw's halos: page boxes mapped to the viewport, redrawn as the view scrolls or zooms. */
export function ExcalidrawPulses({ api }: { api: any }) {
	const pulses = usePulses()
	const [, redraw] = useReducer((n: number) => n + 1, 0)
	useEffect(() => {
		if (!api) return
		const offScroll = api.onScrollChange(redraw)
		const offChange = api.onChange(() => list.length && redraw())
		return () => (offScroll(), offChange())
	}, [api])
	if (!api || !pulses.length) return null
	const { scrollX, scrollY, zoom } = api.getAppState()
	const els = new Map(api.getSceneElements().map((e: any) => [e.id, e]))
	const box = (e: any): Box => ({ x: (e.x + scrollX) * zoom.value, y: (e.y + scrollY) * zoom.value, w: e.width * zoom.value, h: e.height * zoom.value })
	return (
		<div style={{ position: "absolute", inset: 0, zIndex: 3, overflow: "hidden", pointerEvents: "none" }}>
			{pulses.map((p) => (
				<PulseBoxes key={p.key} pulse={p} boxes={p.ids.map((id) => els.get(id)).filter(Boolean).map(box)} />
			))}
		</div>
	)
}
