// routine: Check this diagram
// description: Measures the diagram as drawn, scores it, and points at what is wrong. Changes nothing.
// engines: tldraw

const m = toucan.measure()
const kinds = {}
for (const f of m.findings) (kinds[f.kind] ??= []).push(...f.on)
const words = Object.entries(kinds).map(([kind, on]) => `${kind} (${new Set(on).size})`)
toucan.pulse([...new Set(m.findings.flatMap((f) => f.on))])
return {
	summary: words.length ? `Score ${m.score} of 100: ${words.join(", ")}` : `Score ${m.score} of 100, with nothing wrong.`,
	score: m.score,
	findings: m.findings,
	measures: { aligned: m.aligned, flow: m.flow, textAtFit: m.textAtFit, fitZoom: m.fitZoom },
}
