import { lazy, Suspense, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Index } from './Index'
import { api, token, canvasName } from './net'
// Tailwind's layers sit under tldraw's unlayered CSS, and its preflight is scoped to .toucan-ui
// (see style.css), so the canvas keeps its own styling. tldraw (and its CSS) loads with App, so the
// index stays light.
import './style.css'

// Each engine (and its CSS and fonts) loads only for canvases that use it.
const ENGINES: Record<string, React.LazyExoticComponent<() => React.JSX.Element>> = {
	tldraw: lazy(() => import('./App').then((m) => ({ default: m.App }))),
	excalidraw: lazy(() => import('./ExcalidrawApp').then((m) => ({ default: m.ExcalidrawApp }))),
}

function Canvas() {
	const [engine, setEngine] = useState<string | null>(null)
	const [error, setError] = useState('')
	useEffect(() => {
		api(`/api/canvases/${encodeURIComponent(canvasName)}/info`).then((c) => setEngine(c.engine), (e) => setError(String(e.message ?? e)))
	}, [])
	if (error) return <p className="toucan-ui p-6 text-sm text-destructive">{error}</p>
	if (!engine) return null
	const Engine = ENGINES[engine]
	if (!Engine) return <p className="toucan-ui p-6 text-sm text-destructive">Unknown engine “{engine}”.</p>
	return (
		<Suspense>
			<Engine />
		</Suspense>
	)
}

const root = createRoot(document.getElementById('root')!)
root.render(
	token ? (
		canvasName ? (
			<Canvas />
		) : (
			<Index />
		)
	) : (
		<div className="toucan-ui flex min-h-full items-start justify-center bg-background px-4 pt-[20vh] text-foreground">
			<div className="max-w-md space-y-3">
				<h1 className="text-2xl font-semibold">toucan</h1>
				<p className="text-muted-foreground">
					Sign in by opening the link printed by <code className="rounded bg-muted px-1 py-0.5 font-mono text-sm">node bin/toucan.mjs url</code> on the server.
				</p>
			</div>
		</div>
	),
)
