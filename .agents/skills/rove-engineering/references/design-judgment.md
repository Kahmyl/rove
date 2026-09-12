# Design judgment

Use this procedure when a change materially affects domain ownership, persistent data, process or service boundaries, contracts, concurrency, security or permissions, failure and recovery semantics, cross-cutting capability ownership, or a significant dependency introduction or replacement.

1. State the required invariant and externally observable outcome.
2. Trace current ownership, callers, consumers, data flow, persisted representations, and failure paths.
3. Separate actual product and compatibility requirements from accidental implementation constraints.
4. When a meaningful choice exists, identify a small set of credible designs.
5. Compare them proportionately on correctness, complexity, compatibility and migration, concurrency, failure and recovery, security, and future leverage appropriate to Rove's current stage.
6. Choose the smallest design that completely satisfies the requirement.
7. Record rationale in the owning canonical contract, code, or focused decision comment in proportion to its durability and consequence.
8. Implement the coherent slice and verify its invariants and observable outcomes.

Trivial or obviously correct local fixes do not need this ceremony. Do not invent alternatives when there is no meaningful choice. Architecture reasoning is not permission to expand product scope, adopt speculative infrastructure, or reopen settled product behavior.
