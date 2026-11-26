# Somm project-pages trial verdict

**Keep the new first-call chapter. The broader redesign is incomplete.** Previously, a visitor could read a sample invocation and then open the component catalog. Now “Inspect a local call” takes them to an actual response and its corresponding status entry. They can see that generation returns the answer text while the ledger records the provider, model, token counts and outcome. The earlier routes into the catalog and design rationale remain available.

[Private candidate](https://lavallee--18412.getbb.app/somm/) · [Original](https://lavallee--18411.getbb.app/somm/) · [First-call chapter](first-call.webp) · [Desktop comparison](homepage-1440.webp) · [Phone comparison](homepage-390.webp)

## What the evaluator verified

- Repeated the published generate and status commands using a disposable home and project, cleared environment and loopback Ollama. The response was “pong”. Both records agreed on the workload, model and counts (34 tokens in and two out). The status record showed one success and zero failures. Every displayed JSON field matched the independent run. Opened the individual SQLite row disclosure with the keyboard and executed its query against the disposable project. The selected fields matched, allowing for the new call’s latency.
- Followed the primary action to the first call, then the link to the ledger section, then its return link. The complete round trip worked at 390, 640, 641 and 1440 pixels. The two command panels stacked on phones. The landing heading was visible on both sides of the breakpoint.
- Compared the home, components, glossary, rationale and errors routes at 390, 768 and 1440 pixels under the real /somm/ prefix. All prior IDs survived. The local link and fragment inventory found zero broken destinations, Chromium reported zero page exceptions, and no route overflowed the viewport. The repository release-version check passed at 0.30.0. This was a private static-site trial. The package CI matrix and a public deployment were outside the evaluation.
- The homepage gained the proof chapter and the components page gained a return link. The rest of the collection received no comparable change in how it presents evidence. The new chapter retains the project’s terminal typography, warm status label and restrained code panels. The experiment therefore demonstrates a better first visit, while the requirement to carry the design through the collection remains open.

## What changes in the next assignment

Keep the decision separate for each outcome. Did a reader gain a useful path? Did the agent carry the design across the collection? Can the exact candidate ship? The protocol and guide as given to Luna are preserved alongside this report. Flip and Somm are different products with one trial apiece, so this comparison cannot establish how much of the gain came from the revised brief.

The subsequent guide adds an isolation check before the first product command and asks the implementer to name three distinct routes with an observable improvement for each. These additions await a fresh trial.

## Candidate and capture conditions

The independently evaluated static pages are frozen in local Somm commit b00133d, based on 04f63ea. During an early local call, Luna read the normal home configuration and saw a quota warning. Luna reports that the call wrote to a temporary ledger with cross-project mirroring disabled and changed no settings. The trial discarded that output. The published-looking example in the private preview came from a new, isolated run and was verified independently. Reproducing it requires Ollama and the named local model.
