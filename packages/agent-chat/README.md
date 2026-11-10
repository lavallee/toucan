# @lyra-forge/agent-chat

Shared Toucan and Copycat chat shell, conversation, composer and shadcn primitives.
React is a peer dependency. Consumers generate Tailwind utilities from this package source and provide their theme tokens.

Transport, agents, canvas/page context, proposal application, saves and releases belong to each app. The component does not execute model calls or edit a document.

Source lives in Toucan packages/agent-chat. Copycat consumes a pinned npm-pack artifact with source provenance. Update the package here and repack; do not edit a consumer bundle.
