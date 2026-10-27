import { useCallback, useState } from 'react'
import * as tl from 'tldraw'
import { Tldraw, inlineBase64AssetStore, react, type Editor } from 'tldraw'
import 'tldraw/tldraw.css'
import { useSync } from '@tldraw/sync'
import { makeHelpers } from './helpers.js'
import { wsUrl } from './net'
import { connectRelay, keepThumbnail, applySeed } from './relay'
import { CanvasFrame } from './CanvasFrame'

declare global {
	interface Window {
		editor: any
		toucan: any
	}
}

// The chat panel's shadcn theme follows tldraw's resolved colour mode (which defaults to the OS).
const setDark = (dark: boolean) => document.documentElement.classList.toggle('dark', dark)
setDark(matchMedia('(prefers-color-scheme: dark)').matches)

/** The tldraw engine. */
export function App() {
	const [status, setStatus] = useState('connecting')

	const onMount = useCallback((editor: Editor) => {
		const toucan = makeHelpers(editor)
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
			<Tldraw store={store} onMount={onMount} colorScheme="system" licenseKey={import.meta.env.VITE_TLDRAW_LICENSE_KEY} />
		</CanvasFrame>
	)
}
