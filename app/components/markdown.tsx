import * as React from 'react'
import { Streamdown, useIsCodeFenceIncomplete, type ExtraProps } from 'streamdown'

import { useHighlightedCode } from '@/hooks/use-highlighted-code'
import {
	CodeBlock,
	CodeBlockActions,
	CodeBlockContent,
	CodeBlockCopyButton,
	CodeBlockHeader,
	CodeBlockLine,
	CodeBlockTitle,
} from '@/components/ui/code-block'
import { cn } from '@/lib/utils'

// Agent replies: Streamdown for streaming markdown, fenced code routed to CodeBlock
// (pattern from https://ui.shadcn.com/docs/components/radix/code-block#markdown).

function MarkdownCodeBlock({ code, language }: { code: string; language: string }) {
	// True while the closing fence has not arrived yet.
	const incomplete = useIsCodeFenceIncomplete()
	const lines = useHighlightedCode(code, language)

	return (
		<CodeBlock size="sm" className="my-2">
			<CodeBlockHeader>
				<CodeBlockTitle>{language || 'text'}</CodeBlockTitle>
				<CodeBlockActions>
					<CodeBlockCopyButton value={code} disabled={incomplete} />
				</CodeBlockActions>
			</CodeBlockHeader>
			<CodeBlockContent className="max-h-80">
				{lines.map((line, index) => (
					<CodeBlockLine key={index}>{line}</CodeBlockLine>
				))}
			</CodeBlockContent>
		</CodeBlock>
	)
}

function MarkdownCode({ node, className, children, ...props }: React.ComponentProps<'code'> & ExtraProps) {
	// Streamdown marks fenced code with data-block. Everything else is inline.
	if (!('data-block' in props)) {
		return (
			<code className="rounded-sm bg-muted px-1 py-0.5 font-mono text-[0.9em]" {...props}>
				{children}
			</code>
		)
	}
	return (
		<MarkdownCodeBlock
			code={typeof children === 'string' ? children : String(children ?? '')}
			language={/language-(\S+)/.exec(className ?? '')?.[1] ?? ''}
		/>
	)
}

const components = { code: MarkdownCode }

// `components` replaces how some elements render (the References panel's links and images); `urlTransform` keeps
// links it resolves itself, which Streamdown would otherwise drop as unsafe.
export function Markdown({
	children,
	streaming,
	className,
	components: more,
	urlTransform,
	rehypePlugins,
}: {
	children: string
	streaming?: boolean
	className?: string
	components?: Record<string, React.ComponentType<any>>
	urlTransform?: (url: string) => string
	rehypePlugins?: any[]
}) {
	return (
		<Streamdown className={cn('text-sm leading-relaxed', className)} controls={false} components={more ? { ...components, ...more } : components} isAnimating={streaming} {...(urlTransform && { urlTransform })} {...(rehypePlugins && { rehypePlugins })}>
			{children}
		</Streamdown>
	)
}
