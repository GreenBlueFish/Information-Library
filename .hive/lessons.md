# Lessons

What was reverted and why.

## Keep non-SNN topics standalone (2026-11-01)

The Communication Protocols and VGA pages first shipped with sections tying
them to spiking neural networks (PR #43). The person asked for those to be
taken out (PR #48), in their words:

> please don't mention it's relivance to spiking neural networks (remove this
> part) as this is a different topic. The information Library is just a place
> to hold information for me to learn, I will let you know if ideas connect.

**How to apply:** goals.md is about SNNs, but not every topic in the library
is. A topic outside SNNs and neuroscience is written to stand on its own: no
"relevance to SNNs" sections, asides or examples, unless the person asks for
the link. Pages that are already about SNNs or the brain (such as the
cell-types pages) are not covered by this; the person has not said whether
their "What this means for your SNN" sections should stay.
- 2026-11-02: "Follow up the review of Give the Computational Cortical Columns pages working JS simulations they don't have yet" (PR #61, a999caa8) was reverted: the tests went red after it merged: skipped (known gap): src/ingest/extraction-smoke.test.js | skipped (known gap): src/ingest/flagged-not-authored.property.test.js | skipped (known gap): src/ingest/inventory-completeness.test.js | skipped (known gap): src/ingest/inventory-schema.property.test.js
