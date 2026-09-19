# Planning

**Role:** Active implementation sequencing derived from approved Product and Engineering contracts.

Planning documents answer **how approved work will be investigated, ordered, implemented, and verified**. They are intentionally separate from the canonical Product and Engineering documents.

## Authority

The documentation order remains:

1. Product Brief and Product Direction
2. Product policy and operating model
3. Engineering contracts
4. Implementation Status
5. Planning documents

A plan cannot silently change product purpose, user-control rules, persistence boundaries, security authority, or engineering contracts. When investigation shows that one of those contracts is wrong or incomplete, update the responsible canonical document first. Then update the plan to sequence implementation against the corrected contract.

Planning documents also do not prove that planned behavior exists. Evidence-backed current capability remains the responsibility of [Implementation Status](../Engineering/implementation-status.md).

## What belongs here

A planning document may contain:

- the problem and evidence motivating the work;
- affected canonical documents and settled constraints;
- current implementation gaps;
- open engineering questions that still require investigation;
- coherent implementation slices and their dependencies;
- migration/compatibility considerations;
- verification requirements and regression evidence;
- stop conditions and completion criteria;
- explicit non-goals that prevent scope drift.

A planning document should not become:

- a competing product brief or architecture;
- a chronological diary of every command or review;
- a second implementation-status table;
- a hidden source of permissions or security policy;
- a permanent milestone/version taxonomy for a pre-release product.

Use descriptive filenames based on the work itself. Remove or archive obsolete planning guidance through normal Git history when the implementation and canonical contracts no longer need an active sequence.

## Active plans

- [Adaptive Browser Execution and Reconciliation](adaptive-browser-execution-and-reconciliation.md)
- [Codex Event Ingestion and Task-State Reconciliation](codex-event-ingestion-and-task-state-reconciliation.md)
