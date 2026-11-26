# Flip style-guide implementation trial

One uncoached GPT-6 Luna implementation from Flip commit `66f87bc` (version 0.27.0). The guide supplied was the Toucan project-pages guide, SHA-256 `760092ac789007fc18a64c1ed4e5c66916ab750961416ae33875fa97109aac2f`. The agent received the guide's starter assignment, a dedicated writable Flip checkout, instructions to preserve product content, leave a runnable candidate and handoff, and keep the work private. The evaluator did not give it design solutions.

## Decision rule set before inspecting the candidate

Judge each dimension **pass**, **partial**, or **fail** against both the starting site and the guide. Existing strengths count for preservation, not as improvements attributable to the agent.

| Dimension | What the reviewer will try |
| --- | --- |
| Orientation and proof | Identify the intended reader, their job and an observable result from the opening. Check its example against generated Flip records. |
| Next action and first run | Follow the principal homepage link, carry out its promised task, and check any new or changed commands against the actual CLI. |
| Collection structure | Check home, start, worked conversation, notebook, spec and 404; inspect roles, duplication, nav and footer. |
| Visual system and reading | Compare before/after screenshots at 390 and 1440; inspect first-screen hierarchy, legibility, proof placement and dense content. Test near the actual menu breakpoint. |
| Preservation and accuracy | Compare old links and anchors; operate flipbook receipts, claim/source navigation and spec controls; check release and rights. |
| Reproducibility and handoff | Compare source edits with build products, rebuild and serve under /flip/, verify the agent's stated checks and identify any untested behavior. |

Ready to use as submitted requires a meaningful improvement and passing all six. A broken core interaction, inaccurate public claim, or non-reproducible page blocks acceptance. A working private candidate may still need editorial revision. This single run tests usability of the guide on this particular collection; it does not estimate a model-wide success rate.
