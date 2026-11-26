import { useCallback } from 'react'
import { HistoryPanel, type VersionPreview } from '@lyra-forge/leyline/history-panel'
import { api, canvasName } from './net'

export type { VersionRow, VersionPreview } from '@lyra-forge/leyline/history-panel'

const base = `/api/canvases/${encodeURIComponent(canvasName)}/versions`

/**
 * The evolution of a canvas: the shared History panel (Leyline's `./history-panel`) over this
 * canvas's versions. A version is shown read-only over the live canvas, which keeps running
 * underneath; restoring puts it back for everyone, after saving what is there now.
 */
export function History({ Preview, onClose }: { Preview: VersionPreview; onClose: () => void }) {
	const loadVersions = useCallback(() => api(base), [])
	const readVersion = useCallback((n: number) => api(`${base}/${n}`), [])
	const restoreVersion = useCallback((n: number) => api(`${base}/${n}/restore`, { method: 'POST' }), [])
	const saveVersion = useCallback((label: string) => api(base, { method: 'POST', body: JSON.stringify({ label }) }), [])
	return (
		<HistoryPanel
			loadVersions={loadVersions}
			readVersion={readVersion}
			restoreVersion={restoreVersion}
			saveVersion={saveVersion}
			Preview={Preview}
			onClose={onClose}
			words={{ document: 'canvas', part: 'shape', restoreNote: "What's on the canvas now is saved first." }}
		/>
	)
}
