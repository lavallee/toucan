import * as React from 'react'
import { Popover as PopoverPrimitive } from 'radix-ui'
import { cn } from 'cn'

const Popover = PopoverPrimitive.Root
const PopoverTrigger = PopoverPrimitive.Trigger

// Portalled to <body>, so it carries .toucan-ui itself, and keeps typing away from tldraw's document listeners.
function PopoverContent({ className, align = 'end', sideOffset = 6, container, ...props }: React.ComponentProps<typeof PopoverPrimitive.Content> & { container?: HTMLElement | null }) {
	return (
		<PopoverPrimitive.Portal container={container}>
			<PopoverPrimitive.Content
				data-slot="popover-content"
				align={align}
				sideOffset={sideOffset}
				collisionPadding={8}
				onKeyDown={(e) => e.stopPropagation()}
				onKeyUp={(e) => e.stopPropagation()}
				onPaste={(e) => e.stopPropagation()}
				className={cn('toucan-ui z-[1000] w-72 max-w-[calc(100vw-1rem)] rounded-lg border bg-popover p-3 text-sm text-popover-foreground shadow-md outline-none', className)}
				{...props}
			/>
		</PopoverPrimitive.Portal>
	)
}

export { Popover, PopoverContent, PopoverTrigger }
