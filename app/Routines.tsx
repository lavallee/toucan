import { RoutineMenu } from '../packages/agent-chat/src/routine-menu'
import { api, canvasName } from './net'
export function Routines({engine,onAskAgent}:{engine:string;onAskAgent:()=>void}) {
 return <RoutineMenu engine={engine} onAskAgent={onAskAgent} loadRoutines={()=>api('/api/routines?code')} runRoutine={name=>api(`/api/canvases/${encodeURIComponent(canvasName)}/routines/${name}/run`,{method:'POST',body:'{}'})} saveRoutine={(name,parts)=>api(`/api/routines/${name}`,{method:'PUT',body:JSON.stringify(parts)})} removeRoutine={name=>api(`/api/routines/${name}`,{method:'DELETE'})} />
}
