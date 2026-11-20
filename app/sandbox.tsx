// A copy of the canvas to try things on: a second tldraw editor, hidden, with the same document and nothing synced. A
// reflex's trial (lib/reflexes.mjs, tryProgram) brings its situation about there, answers it and judges again, so the live
// canvas never changes and nobody sees a thing. The copy measures text with the same fonts as the canvas, so what fits there
// fits here.
import { createRoot } from 'react-dom/client'
import { Tldraw, getSnapshot, loadSnapshot, type Editor } from 'tldraw'

type Helpers = (editor: Editor) => any

export function makeCopy(editor: Editor, makeHelpers: Helpers, assetUrls?: Record<string, unknown>, licenseKey?: string) {
	return async function withCopy<T>(fn: (editor: Editor, toucan: any) => Promise<T>): Promise<T> {
		const host = document.createElement('div')
		Object.assign(host.style, { position: 'fixed', left: '-20000px', top: '0', width: '1600px', height: '1000px', visibility: 'hidden', pointerEvents: 'none' })
		host.setAttribute('aria-hidden', 'true')
		document.body.append(host)
		const root = createRoot(host)
		try {
			const copy = await new Promise<Editor>((resolve, reject) => {
				const timer = setTimeout(() => reject(new Error('the copy of the canvas did not start')), 15000)
				root.render(<Tldraw hideUi autoFocus={false} assetUrls={assetUrls as any} licenseKey={licenseKey} onMount={(e) => (clearTimeout(timer), resolve(e))} />)
			})
			loadSnapshot(copy.store, { document: getSnapshot(editor.store).document })
			const page = editor.getCurrentPageId()
			if (copy.getPage(page)) copy.setCurrentPage(page)
			await document.fonts?.ready
			// What the copy would show people (a glow, the view moving to new shapes) has nowhere to go: its ids are the canvas's own.
			const helpers = makeHelpers(copy)
			helpers.pulse = () => {}
			helpers.reveal = () => {}
			return await fn(copy, helpers)
		} finally {
			root.unmount()
			host.remove()
		}
	}
}
