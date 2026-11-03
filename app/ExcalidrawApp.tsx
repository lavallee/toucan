import { useEffect, useRef, useState } from 'react'
import * as ex from '@excalidraw/excalidraw'
import { Excalidraw, CaptureUpdateAction, reconcileElements, restoreElements } from '@excalidraw/excalidraw'
import '@excalidraw/excalidraw/index.css'
import { makeExcalidrawHelpers } from './excalidraw-helpers.js'
import { wsUrl } from './net'
import { connectRelay, keepThumbnail } from './relay'
import { CanvasFrame } from './CanvasFrame'
import { ExcalidrawPulses } from './pulses'
import { ProposalBar } from './ProposalBar'
import { ThreadsLayer } from './Threads'
import { DetailsCard } from './Details'
import { startComment } from './threads-store'
import { getAppearance, useAppearance } from './theme'

// Fonts are served from our own dist/ (copied there at build time), not a CDN.
;(window as any).EXCALIDRAW_ASSET_PATH = `${location.origin}/excalidraw/`

const FONT_NAMES: Record<number, string> = Object.fromEntries(Object.entries(ex.FONT_FAMILY).map(([name, id]) => [id, name]))

// "Clean" lettering: what people draw here starts in a plain font with clean lines. Unlike on tldraw,
// Excalidraw's fonts can't be swapped underneath existing text; the "Straighten sketchy lines" routine converts it.
const initialAppState = getAppearance().lettering === 'clean' ? { currentItemFontFamily: ex.FONT_FAMILY.Helvetica, currentItemRoughness: 0 } : {}

/** A saved version, read-only, stepped through without touching the live canvas. */
function VersionPreview({ data }: { data: any }) {
	const [api, setApi] = useState<any>(null)
	const { dark } = useAppearance()
	const scene = (d: any) => restoreElements(d.elements.filter((e: any) => !e.isDeleted), null, { refreshDimensions: true, repairBindings: true })
	// The first version arrives as initialData (Excalidraw would overwrite a scene set while it starts up); steps follow by update.
	const [first] = useState(() => ({ elements: scene(data) }))
	const shown = useRef(data)
	useEffect(() => {
		if (!api) return
		const t = setTimeout(() => api.scrollToContent(undefined, { fitToContent: true }), 100)
		return () => clearTimeout(t)
	}, [api])
	useEffect(() => {
		if (!api || shown.current === data) return
		shown.current = data
		api.updateScene({ elements: scene(data), captureUpdate: CaptureUpdateAction.NEVER })
	}, [api, data])
	return <Excalidraw excalidrawAPI={setApi} initialData={first} viewModeEnabled theme={dark ? 'dark' : 'light'} UIOptions={{ canvasActions: { loadScene: false } }} />
}

/**
 * The Excalidraw engine. The server keeps one element list per canvas (/ws/excalidraw): this tab
 * sends the elements whose version moved past what it last sent or received, and merges what other
 * tabs changed with Excalidraw's reconcileElements.
 */
export function ExcalidrawApp() {
	const [api, setApi] = useState<any>(null)
	const [relay, setRelay] = useState('connecting')
	const [sync, setSync] = useState('connecting')
	const known = useRef(new Map<string, number>()) // element id -> version last sent or received
	const [helpers, setHelpers] = useState<{ toucan: any; subscribe: (f: () => void) => () => void } | null>(null)
	const { dark } = useAppearance()

	useEffect(() => {
		if (!api) return
		const toucan = makeExcalidrawHelpers(api, ex)
		setHelpers({ toucan, subscribe: (f) => api.onChange(f) })
		;(window as any).editor = api
		;(window as any).toucan = toucan

		let ws: WebSocket | undefined,
			closed = false,
			ready = false,
			flush: ReturnType<typeof setTimeout> | undefined,
			stopRelay = () => {}
		const remember = (els: readonly any[]) => els.forEach((e) => known.current.set(e.id, e.version))
		const apply = (incoming: any[], first: boolean) => {
			const remote = restoreElements(incoming, null, { refreshDimensions: true, repairBindings: true })
			const elements = first ? remote : reconcileElements(api.getSceneElementsIncludingDeleted(), remote as any, api.getAppState())
			remember(incoming)
			api.updateScene({ elements, captureUpdate: CaptureUpdateAction.NEVER })
		}
		function connect() {
			ws = new WebSocket(wsUrl('/ws/excalidraw'))
			const sock = ws
			sock.onmessage = (ev) => {
				const msg = JSON.parse(ev.data)
				if (msg.type === 'scene') {
					apply(msg.elements, !ready)
					if (!ready) {
						// Agent code runs only once the scene is here, or it would see (and build on) an empty canvas.
						stopRelay = connectRelay({ editor: api, tl: ex, toucan }, setRelay)
						api.scrollToContent(undefined, { fitToContent: true })
						// Labels measured before their font arrived are clipped to the fallback width: re-measure once it has.
						const families = new Set(api.getSceneElements().filter((e: any) => e.type === 'text').map((e: any) => FONT_NAMES[e.fontFamily]).filter(Boolean))
						Promise.all([...families].map((f) => document.fonts.load(`16px ${f}`))).then(() => {
							const els = api.getSceneElementsIncludingDeleted()
							api.updateScene({ elements: restoreElements(els, null, { refreshDimensions: true, repairBindings: true }), captureUpdate: CaptureUpdateAction.NEVER })
						})
					}
					ready = true
					setSync('synced')
					send() // anything edited while disconnected
				} else if (msg.type === 'update') apply(msg.elements, false)
			}
			sock.onclose = () => {
				setSync('offline')
				if (!closed) setTimeout(connect, 1500)
			}
		}
		function send() {
			if (!ready || ws?.readyState !== 1) return
			const changed = api.getSceneElementsIncludingDeleted().filter((e: any) => (known.current.get(e.id) ?? -1) < e.version)
			if (!changed.length) return
			remember(changed)
			ws.send(JSON.stringify({ type: 'update', elements: changed }))
		}
		const stopChange = api.onChange(() => {
			clearTimeout(flush)
			flush = setTimeout(send, 60)
		})
		connect()

		const stopThumbnail = keepThumbnail(
			async () => {
				const els = api.getSceneElements()
				if (!els.length) return null
				return ex.exportToBlob({ elements: els, appState: { ...api.getAppState(), exportBackground: true, viewBackgroundColor: '#ffffff', exportWithDarkMode: false }, files: api.getFiles(), maxWidthOrHeight: 800, mimeType: 'image/png' })
			},
			(onChange) => {
				let last = 0
				return api.onChange((els: readonly any[]) => {
					const v = ex.getSceneVersion(els)
					if (v !== last) (last = v), onChange()
				})
			},
		)
		return () => {
			closed = true
			ws?.close()
			stopChange()
			stopRelay()
			stopThumbnail()
		}
	}, [api])

	return (
		<CanvasFrame live={relay === 'live' && sync === 'synced'} engine="excalidraw" preview={VersionPreview} onComment={() => startComment(helpers?.toucan)}>
			<div className="absolute inset-0">
				<Excalidraw excalidrawAPI={setApi} theme={dark ? 'dark' : 'light'} initialData={{ appState: initialAppState }} UIOptions={{ canvasActions: { loadScene: false } }} />
				<ExcalidrawPulses api={api} />
				{helpers && <ProposalBar {...helpers} />}
				{helpers && <ThreadsLayer {...helpers} />}
				{helpers && <DetailsCard {...helpers} />}
			</div>
		</CanvasFrame>
	)
}
