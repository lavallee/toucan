import { lazy, Suspense, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Index } from './Index'
import { api, token, canvasName } from './net'
import './theme'
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

/**
 * No token in this browser for this address yet. A sign-in link from `toucan open` or `toucan url` does it in one click;
 * pasting that link, or the token itself, does it from a browser the CLI can't reach, such as a server's own name on
 * another machine. The token is checked with the server before it's kept.
 */
function SignIn() {
	const [value, setValue] = useState('')
	const [error, setError] = useState('')
	const [busy, setBusy] = useState(false)
	const submit = async (e: React.FormEvent) => {
		e.preventDefault()
		const v = value.trim()
		const t = (v.match(/[#&?]token=([^&\s]+)/)?.[1] ?? v).trim()
		if (!t) return
		setBusy(true)
		setError('')
		try {
			const res = await fetch('/api/health', { headers: { authorization: `Bearer ${decodeURIComponent(t)}` } })
			if (!res.ok) throw new Error(res.status === 401 ? "That isn't this server's token." : `The server answered ${res.status}.`)
			localStorage.setItem('toucan.token', decodeURIComponent(t))
			location.reload()
		} catch (err) {
			setError(String((err as Error).message ?? err))
			setBusy(false)
		}
	}
	const code = 'rounded bg-muted px-1 py-0.5 font-mono text-sm'
	return (
		<div className="toucan-ui flex min-h-full items-start justify-center bg-background px-4 pt-[20vh] text-foreground">
			<div className="w-full max-w-md space-y-3">
				<h1 className="text-2xl font-semibold">toucan</h1>
				<p className="text-muted-foreground">
					Sign in by running <code className={code}>toucan open</code> on the machine toucan runs on. From anywhere else, paste the link that{' '}
					<code className={code}>toucan url</code> prints there, or the token in it.
				</p>
				<form onSubmit={submit} className="flex gap-2">
					<input
						value={value}
						onChange={(e) => setValue(e.target.value)}
						placeholder="Sign-in link or token"
						aria-label="Sign-in link or token"
						autoComplete="off"
						spellCheck={false}
						className="h-9 min-w-0 flex-1 rounded-md border bg-background px-3 font-mono text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
					/>
					<button type="submit" disabled={busy || !value.trim()} className="h-9 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-50">
						Sign in
					</button>
				</form>
				{error && <p className="text-sm text-destructive">{error}</p>}
				<p className="text-xs text-muted-foreground">This browser keeps it for this address, {location.host}.</p>
			</div>
		</div>
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
		<SignIn />
	),
)
