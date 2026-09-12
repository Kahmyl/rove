# Independent candidate review

Use this procedure for an explicitly requested review or when a stable candidate's risk justifies an independent pass. Default to read-only review unless remediation is explicitly requested.

1. Establish the requirements, non-goals, repository root, branch, frozen HEAD, and clean/dirty status. If the candidate changes during review, stop and re-establish the review baseline.
2. Inspect the actual diff from its stated base, then inspect surrounding unchanged source wherever behavior depends on it.
3. Read the meaningful test assertions and available evidence. Distinguish source-supported claims from behavior actually executed by tests.
4. Assess correctness, ownership, persistence, concurrency, recovery, security, compatibility, and user-visible behavior in proportion to the change.
5. Classify each finding as a confirmed defect, an evidence gap, or an unproven risk. Do not present speculation as a defect.
6. For every actionable finding, provide severity, triggering scenario, consequence, precise evidence, and the smallest credible correction.
7. Avoid unrelated redesign. Use a bounded requirement/evidence matrix when it materially clarifies acceptance.
8. Return findings to the root agent or human for remediation and acceptance. The reviewer does not become a competing architecture authority.

The intended flow is: implementer freezes a candidate; a separate Codex task or bounded review subagent inspects the same candidate; the root agent or human decides remediation and acceptance. Independent review is not mandatory after every trivial change and does not require ChatGPT specifically.
