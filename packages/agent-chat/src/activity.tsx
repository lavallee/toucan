import * as React from 'react'
import { LoaderCircleIcon, CircleCheckIcon, WrenchIcon, CircleAlertIcon } from 'lucide-react'
import { Trace, TraceLine, TraceIcon, TraceTitle, TraceCollapsible, TraceCollapsibleContent, TraceCollapsibleTrigger } from './ui/trace'
// Reasoning pattern: opens while the model thinks, closes when done, unless the person chose.
export function ReasoningLine({ text, running, renderText = (text) => <p className="whitespace-pre-wrap">{text}</p> }: { text: string; running: boolean; renderText?: (text: string) => React.ReactNode }) {
	const [open, setOpen] = React.useState<boolean>()
	const line = (
		<TraceLine status={running ? 'running' : undefined}>
			<TraceIcon>{running ? <LoaderCircleIcon className="animate-spin" /> : <CircleCheckIcon />}</TraceIcon>
			<TraceTitle>{running ? 'Thinking' : 'Thought'}</TraceTitle>
		</TraceLine>
	)
	if (text.length === 0) return line
	return (
		<TraceCollapsible open={open ?? running} onOpenChange={setOpen}>
			<TraceCollapsibleTrigger>{line}</TraceCollapsibleTrigger>
			<TraceCollapsibleContent>
				<div className="text-muted-foreground">{renderText(text)}</div>
			</TraceCollapsibleContent>
		</TraceCollapsible>
	)
}

export function ActivityLog({ items, running }: { items: {id:string;kind:string;text:string;status?:string;title?:string}[]; running:boolean }) {
 return <Trace>{items.map(item => item.kind==='reasoning' ? <ReasoningLine key={item.id} text={item.text} running={running && item.status==='running'} /> : <TraceCollapsible key={item.id}><TraceCollapsibleTrigger><TraceLine status={item.status==='failed'?'error':running && item.status==='running'?'running':undefined}><TraceIcon>{item.status==='failed'?<CircleAlertIcon/>:<WrenchIcon/>}</TraceIcon><TraceTitle>{item.title || 'Agent activity'}</TraceTitle></TraceLine></TraceCollapsibleTrigger>{item.text && <TraceCollapsibleContent><p className="whitespace-pre-wrap text-xs">{item.text}</p></TraceCollapsibleContent>}</TraceCollapsible>)}</Trace>
}
