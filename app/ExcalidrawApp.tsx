import { useEffect, useRef, useState } from 'react'
import * as ex from '@excalidraw/excalidraw'
import { Excalidraw, CaptureUpdateAction, reconcileElements, restoreElements } from '@excalidraw/excalidraw'
import '@excalidraw/excalidraw/index.css'
import { makeExcalidrawHelpers } from './excalidraw-helpers.js'
import { wsUrl } from './net'
import { connectRelay, keepThumbnail } from './relay'
import { CanvasFrame } from './CanvasFrame'

// Fonts are served from our own dist/ (copied there at build time), not a CDN.
;(window as any).EXCALIDRAW_ASSET_PATH = `${location.origin}/excalidraw/`

const FONT_NAMES: Record<number, string> = Object.fromEntries(Object.entries(ex.FONT_FAMILY).map(([name, id]) => [id, name]))

const dark = matchMedia('(prefers-color-scheme: dark)').matches
document.documentElement.classList.toggle('dark', dark)

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

	useEffect(() => {
		if (!api) return
		const toucan = makeExcalidrawHelpers(api, ex)
		;(window as any).editor = api
		;(window as any).toucan = toucan

		let ws: WebSocket | undefined,
			closed = false,
			ready = false,
			flush: ReturnType<typeof setTimeout> | undefined
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

		const stopRelay = connectRelay({ editor: api, tl: ex, toucan }, setRelay)
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
		<CanvasFrame live={relay === 'live' && sync === 'synced'} engine="excalidraw" badgeClassName="bottom-16 left-2">
			<div className="absolute inset-0">
				<Excalidraw excalidrawAPI={setApi} theme={dark ? 'dark' : 'light'} UIOptions={{ canvasActions: { loadScene: false } }} />
			</div>
		</CanvasFrame>
	)
}
