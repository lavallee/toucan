import { MonitorIcon, MoonIcon, SunIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'
import { myName, setMyName } from './threads-store'
import { setLettering, setTheme, useAppearance, type Lettering, type Theme } from './theme'

const THEMES: { value: Theme; label: string; Icon: typeof SunIcon }[] = [
	{ value: 'system', label: 'System', Icon: MonitorIcon },
	{ value: 'light', label: 'Light', Icon: SunIcon },
	{ value: 'dark', label: 'Dark', Icon: MoonIcon },
]
const LETTERINGS: { value: Lettering; label: string }[] = [
	{ value: 'clean', label: 'Clean' },
	{ value: 'handwritten', label: 'Handwritten' },
]

function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string; Icon?: typeof SunIcon }[]; onChange: (v: T) => void }) {
	return (
		<div role="radiogroup" aria-label={label} className="flex rounded-lg border p-0.5">
			{options.map(({ value: v, label: text, Icon }) => (
				<button
					key={v}
					type="button"
					role="radio"
					aria-checked={value === v}
					onClick={() => onChange(v)}
					className={cn('flex h-7 flex-1 items-center justify-center gap-1.5 rounded-md text-xs font-medium text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50', value === v && 'bg-muted text-foreground')}
				>
					{Icon && <Icon className="size-3.5" />}
					{text}
				</button>
			))}
		</div>
	)
}

/** The theme override (and the lettering choice), in the app bar and on the index. */
export function AppearanceMenu() {
	const { theme, dark, lettering } = useAppearance()
	const Icon = theme === 'system' ? MonitorIcon : dark ? MoonIcon : SunIcon
	const onLettering = (next: Lettering) => {
		if (next === lettering) return
		setLettering(next)
		// tldraw takes its font files at startup; the index has none to swap.
		if (new URLSearchParams(location.search).has('canvas')) location.reload()
	}
	return (
		<Popover>
			<PopoverTrigger asChild>
				<Button variant="ghost" size="icon-sm" aria-label={`Appearance: ${theme} theme`} title="Appearance">
					<Icon />
				</Button>
			</PopoverTrigger>
			<PopoverContent className="w-64 space-y-3">
				<label className="block space-y-1.5 text-xs font-medium">
					Your name
					<Input className="h-7 text-xs font-normal" defaultValue={myName()} placeholder="Shown on your comments" onChange={(e) => setMyName(e.target.value.trim())} />
				</label>
				<div className="space-y-1.5">
					<p className="text-xs font-medium">Theme</p>
					<Segmented label="Theme" value={theme} options={THEMES} onChange={setTheme} />
				</div>
				<div className="space-y-1.5">
					<p className="text-xs font-medium">Canvas lettering</p>
					<Segmented label="Canvas lettering" value={lettering} options={LETTERINGS} onChange={onLettering} />
					<p className="text-xs text-muted-foreground">
						{lettering === 'clean' ? "tldraw's handwritten font is drawn in a plain sans. Canvases aren't changed." : "tldraw's own handwritten font."} Applies in this browser.
					</p>
				</div>
			</PopoverContent>
		</Popover>
	)
}
