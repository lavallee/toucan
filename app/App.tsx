import { useCallback, useEffect, useRef, useState } from 'react'
import * as tl from 'tldraw'
import { DefaultDashStyle, Tldraw, inlineBase64AssetStore, loadSnapshot, react, useEditor, useValue, type Editor, type TLComponents } from 'tldraw'
import 'tldraw/tldraw.css'
import { useSync } from '@tldraw/sync'
import { makeHelpers } from './helpers.js'
import { wsUrl, headless } from './net'
import { connectRelay, keepThumbnail, applySeed } from './relay'
import { CanvasFrame } from './CanvasFrame'
import { PulseBoxes, usePulses } from './pulses'
import { ProposalBar } from './ProposalBar'
import { getAppearance, setTheme, useAppearance, type Theme } from './theme'
import geist from '@fontsource-variable/geist/files/geist-latin-wght-normal.woff2?url'
import geistItalic from '@fontsource-variable/geist/files/geist-latin-wght-italic.woff2?url'

declare global {
	interface Window {
		editor: any
		toucan: any
	}
}

// "Clean" lettering: tldraw's default handwritten font files are swapped for Geist, so every canvas reads
// plainly (and measures and exports consistently) without touching a single shape. New shapes get clean outlines too.
const clean = getAppearance().lettering === 'clean'
const assetUrls = clean ? { fonts: { tldraw_draw: geist, tldraw_draw_bold: geist, tldraw_draw_italic: geistItalic, tldraw_draw_italic_bold: geistItalic } } : undefined
if (clean) DefaultDashStyle.setDefaultValue('solid')

/** Halos on shapes an agent just changed, drawn in page space on the canvas. */
function AgentPulses() {
	const editor = useEditor()
	const pulses = usePulses()
	const groups = useValue(
		'agent pulses',
		() =>
			pulses.map((p) => {
				const shapes = p.ids.map((id: any) => editor.getShape(id)).filter(Boolean)
				const boxes = shapes.filter((s) => s.type !== 'arrow').map((s) => editor.getShapePageBounds(s)!).map(({ x, y, w, h }) => ({ x, y, w, h }))
				// Arrows glow along their path, not their bounding box.
				const lines = shapes.filter((s) => s.type === 'arrow').map((s) => editor.getShapePageTransform(s).applyToPoints(editor.getShapeGeometry(s).vertices).map(({ x, y }) => ({ x, y })))
				return { p, boxes, lines }
			}),
		[editor, pulses],
	)
	const zoom = useValue('zoom', () => editor.getZoomLevel(), [editor])
	return groups.map(({ p, boxes, lines }) => <PulseBoxes key={p.key} pulse={p} boxes={boxes} lines={lines} scale={zoom} />)
}
const components: TLComponents = { OnTheCanvas: AgentPulses }

/** A saved version, read-only: its own little store, stepped through without touching the live canvas. */
function VersionPreview({ data }: { data: any }) {
	const editor = useRef<Editor | null>(null)
	const snapshot = (room: any) => ({ schema: room.schema, store: Object.fromEntries(room.documents.map((d: any) => [d.state.id, d.state])) })
	useEffect(() => {
		if (editor.current) loadSnapshot(editor.current.store, snapshot(data.room))
	}, [data])
	return (
		<Tldraw
			hideUi
			autoFocus={false}
			assetUrls={assetUrls}
			licenseKey={import.meta.env.VITE_TLDRAW_LICENSE_KEY}
			onMount={(e) => {
				editor.current = e
				loadSnapshot(e.store, snapshot(data.room))
				e.updateInstanceState({ isReadonly: true })
				e.zoomToFit({ animation: { duration: 0 } })
			}}
		/>
	)
}

/** The tldraw engine. */
export function App() {
	const [status, setStatus] = useState('connecting')
	const [helpers, setHelpers] = useState<{ toucan: any; subscribe: (f: () => void) => () => void } | null>(null)
	const [editor, setEditor] = useState<Editor | null>(null)
	const { theme } = useAppearance()
	useEffect(() => {
		editor?.user.updateUserPreferences({ colorScheme: theme })
	}, [editor, theme])

	const onMount = useCallback((editor: Editor) => {
		editor.user.updateUserPreferences({ colorScheme: getAppearance().theme })
		setEditor(editor)
		const toucan = makeHelpers(editor)
		setHelpers({ toucan, subscribe: (f) => editor.store.listen(f) })
		window.editor = editor
		window.toucan = toucan
		// The server's headless page shows up among the collaborators; say what it is.
		if (headless) editor.user.updateUserPreferences({ name: 'agent (headless)' })
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
		// A choice made in tldraw's own menu counts as the theme override too.
		const stopTheme = react('toucan theme', () => {
			const chosen = editor.user.getUserPreferences().colorScheme as Theme | undefined
			if (chosen && chosen !== getAppearance().theme) setTheme(chosen)
		})
		editor.zoomToFit({ animation: { duration: 0 } })
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
		<CanvasFrame live={status === 'live' && store.status === 'synced-remote'} engine="tldraw" preview={VersionPreview}>
			{helpers && <ProposalBar {...helpers} />}
			<Tldraw store={store} onMount={onMount} components={components} assetUrls={assetUrls} colorScheme="system" licenseKey={import.meta.env.VITE_TLDRAW_LICENSE_KEY} />
		</CanvasFrame>
	)
}
