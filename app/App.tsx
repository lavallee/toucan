import { useCallback, useState } from 'react'
import * as tl from 'tldraw'
import { Tldraw, inlineBase64AssetStore, react, useEditor, useValue, type Editor, type TLComponents } from 'tldraw'
import 'tldraw/tldraw.css'
import { useSync } from '@tldraw/sync'
import { makeHelpers } from './helpers.js'
import { wsUrl } from './net'
import { connectRelay, keepThumbnail, applySeed } from './relay'
import { CanvasFrame } from './CanvasFrame'
import { PulseBoxes, usePulses } from './pulses'
import { ProposalBar } from './ProposalBar'

declare global {
	interface Window {
		editor: any
		toucan: any
	}
}

// The chat panel's shadcn theme follows tldraw's resolved colour mode (which defaults to the OS).
const setDark = (dark: boolean) => document.documentElement.classList.toggle('dark', dark)
setDark(matchMedia('(prefers-color-scheme: dark)').matches)

/** Halos on shapes an agent just changed, drawn in page space on the canvas. */
function AgentPulses() {
	const editor = useEditor()
	const pulses = usePulses()
	const groups = useValue(
		'agent pulses',
		() => pulses.map((p) => ({ p, boxes: p.ids.flatMap((id: any) => (editor.getShape(id) ? [editor.getShapePageBounds(id)!].map(({ x, y, w, h }) => ({ x, y, w, h })) : [])) })),
		[editor, pulses],
	)
	const zoom = useValue('zoom', () => editor.getZoomLevel(), [editor])
	return groups.map(({ p, boxes }) => <PulseBoxes key={p.key} pulse={p} boxes={boxes} scale={zoom} />)
}
const components: TLComponents = { OnTheCanvas: AgentPulses }

/** The tldraw engine. */
export function App() {
	const [status, setStatus] = useState('connecting')
	const [helpers, setHelpers] = useState<{ toucan: any; subscribe: (f: () => void) => () => void } | null>(null)

	const onMount = useCallback((editor: Editor) => {
		const toucan = makeHelpers(editor)
		setHelpers({ toucan, subscribe: (f) => editor.store.listen(f) })
		window.editor = editor
		window.toucan = toucan
		const stopRelay = connectRelay({ editor, tl, toucan }, setStatus)
		const stopThumbnail = keepThumbnail(
			async () => {
				const ids = [...editor.getCurrentPageShapeIds()]
				const bounds = editor.getCurrentPageBounds()
				if (!ids.length || !bounds) return null
				const { blob } = await editor.toImage(ids, { format: 'png', scale: Math.min(1, 640 / bounds.w, 400 / bounds.h), pixelRatio: 2, background: true, darkMode: false, padding: 16 })
				return blob
			},
			(onChange) => editor.store.listen(onChange, { scope: 'document' }),
		)
		const stopTheme = react('toucan theme', () => setDark(editor.getColorMode() === 'dark'))
		applySeed(toucan)
		return () => {
			stopRelay()
			stopThumbnail()
			stopTheme()
		}
	}, [])

	// One authoritative document per canvas on the server; every tab stays in sync.
	const store = useSync({ uri: wsUrl('/ws/sync'), assets: inlineBase64AssetStore })

	return (
		<CanvasFrame live={status === 'live' && store.status === 'synced-remote'} engine="tldraw">
			{helpers && <ProposalBar {...helpers} />}
			<Tldraw store={store} onMount={onMount} components={components} colorScheme="system" licenseKey={import.meta.env.VITE_TLDRAW_LICENSE_KEY} />
		</CanvasFrame>
	)
}
