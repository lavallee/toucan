# Redesign fixtures

Ten architecture diagrams (and the six state machines as one flow) that were drawn in Toucan and in D2 to compare their layout.
These keep each diagram's structure, the lengths of its words and its arrows; the words themselves are scrambled (a letter
shift), and ids are numbered, so nothing in them names anyone's project. `scripts/layouts-check.mjs` lays them out and checks
the geometry; `npm run test:diagrams` draws them on one canvas, a frame each, and checks what `measure()` says.
