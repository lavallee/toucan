import { useCallback } from 'react'
import { RoutineMenu, type RoutineSuggestion } from '@lyra-forge/leyline/routine-menu'
import { api, canvasName } from './net'

/** What an agent is asked when a person banks a habit it noticed. */
const bankRequest = (s: RoutineSuggestion) =>
	`Bank this as a routine. It's been done by hand ${s.runs} times${s.canvases.length > 1 ? ` on ${s.canvases.length} canvases` : ''}${s.labels.length ? ` (${s.labels.slice(0, 3).map((l) => `"${l}"`).join(', ')})` : ''}. Make it work from what it finds on any canvas, not from this example's names, try it with exec, and save it with a kind and a when line.\n\n\`\`\`js\n${s.example.slice(0, 3000)}\n\`\`\``

/** The bank of routines: the shared menu (Leyline's `./routine-menu`) over toucan's routines. One run is one undo step. */
export function Routines({ engine, onAskAgent }: { engine: string; onAskAgent: (text?: string) => void }) {
	const loadRoutines = useCallback(() => api('/api/routines?code'), [])
	const loadSuggestions = useCallback(() => api('/api/routines/suggestions?since=60d').then((r) => r.suggestions), [])
	const runRoutine = useCallback((name: string) => api(`/api/canvases/${encodeURIComponent(canvasName)}/routines/${name}/run`, { method: 'POST', body: '{}' }), [])
	const saveRoutine = useCallback((name: string, parts: any) => api(`/api/routines/${name}`, { method: 'PUT', body: JSON.stringify(parts) }), [])
	const removeRoutine = useCallback((name: string) => api(`/api/routines/${name}`, { method: 'DELETE' }), [])
	return (
		<RoutineMenu
			engine={engine}
			onAskAgent={onAskAgent}
			loadRoutines={loadRoutines}
			loadSuggestions={loadSuggestions}
			suggestionRequest={bankRequest}
			runRoutine={runRoutine}
			saveRoutine={saveRoutine}
			removeRoutine={removeRoutine}
		/>
	)
}
