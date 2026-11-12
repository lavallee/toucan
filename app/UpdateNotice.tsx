import { RefreshCwIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useStale } from './update-store'

/** toucan was upgraded while this tab was open: its code is old until it reloads. The canvas is saved, so reloading loses nothing. */
export function UpdateNotice() {
	const stale = useStale()
	if (!stale) return null
	return (
		<Button variant="secondary" size="xs" onClick={() => location.reload()} title="The server has a newer toucan than this tab is running. Your canvas is saved; reloading picks up the new version.">
			<RefreshCwIcon />
			toucan was updated · Reload
		</Button>
	)
}
