# @lyra-forge/agent-chat

Shared Toucan and Copycat header, conversation, composer, activity transcript,
drag/dock/resize layout, routine menu, slash matching and UI primitives. React
is a peer dependency. Consumers generate Tailwind utilities from package source
and supply their theme tokens. Hosts clear drafts after accepting a send.

The `server/rpc` export supplies a JSON-RPC process transport; `server/routines`
supplies deterministic bank storage. Hosts retain thread policies, approvals,
context, event interpretation and execution. Toucan owns canvas operations;
Copycat owns page targeting, proposals, source saves and publication. Sharing a
transport does not share document access or execution authority.

Source lives in Toucan `packages/agent-chat`. Copycat consumes a pinned npm-pack
artifact with source provenance. Update and version the package here, then repack;
never edit a consumer's generated bundle.
