# Rove Product Brief

**Status:** Foundational product brief  
**Product:** Rove  
**Document role:** Canonical product-intent reference

## 1. Purpose of This Document

This document defines what Rove is, why it exists, the product model it is intended to support, and the principles that should guide its development.

Rove existed before this brief was written, and the repository contains architecture, implementation, capability, hardening, and experiment documents produced while the product was still being worked out through implementation. Some of those documents may describe current technical structures accurately while no longer representing the intended product model.

For questions of **product purpose, product concepts, user-facing behavior, and product direction, this brief is authoritative**. Existing technical documentation must not be used to redefine Rove's purpose when it conflicts with this brief. Technical documentation and implementation should be reconciled against the product model over time.

## 2. Product Purpose

Rove is a **task and workflow assistant for getting digital work done**.

Its purpose is not merely to answer questions, generate instructions, or automate a browser. Rove is intended to participate in actual work: a user can give it a task, allow it to use the capabilities available to it, work alongside it when useful, take over when human judgment or action is needed, and receive a useful result from the work performed.

A task may be simple and one-off, or it may belong to a recurring area of work with persistent context and guidance. Rove supports both.

The browser is currently a major execution capability because a large amount of everyday digital work happens through websites. It gives Rove the ability to inspect, navigate, interact with, and act through the same interfaces a user would otherwise operate manually. The browser is a means of performing tasks; it is not the product's purpose or boundary.

Rove should ultimately make meaningful digital work easier to **delegate, continue, repeat, and perform collaboratively with an intelligent assistant**.

## 3. Product Thesis

Most AI assistants are strongest at conversation: the user explains a problem, receives an answer, and remains responsible for carrying the work through the relevant applications and processes.

Many useful tasks require more than an answer. They require moving through websites, inspecting information, comparing options, following a process, making intermediate decisions, preserving context, asking for human input at the right moment, and continuing until the work reaches a useful outcome.

Rove is built around that gap.

The product thesis is that an assistant becomes substantially more useful when it can:

- understand a task as ongoing work rather than only as a prompt-response exchange;
- use execution capabilities, including a browser, to perform parts of that work directly;
- preserve the context needed for recurring categories of work;
- let the human and the assistant exchange control naturally;
- support multiple independent pieces of work without forcing the product into a single global task state; and
- return results in a form appropriate to the task or workflow rather than treating every outcome as another chat response.

## 4. Core Product Model

Rove has two primary units of work:

1. **Tasks**
2. **Workflows**

### 4.1 Tasks

A task is an individual piece of work given to Rove.

Examples include:

- "Go through GitHub and find everything that needs my attention."
- "Find relevant backend-engineering hiring posts on LinkedIn today."
- "Review these opportunities and tell me which ones are worth pursuing."
- "Open this site, investigate this issue, and tell me what is happening."
- "Draft a reply for this person based on what we found."

A task may be **standalone**. The user should not need to create a workflow before asking Rove to do useful work.

A task can also be created **inside a workflow**, in which case it inherits the relevant context, guidance, preferences, and working conventions of that workflow.

Conceptually, tasks should feel as easy to create and return to as chats in a conversational product. A user may have many tasks. Starting or switching to one task should not unnecessarily invalidate or block unrelated tasks.

Low-level resource constraints may occasionally prevent two operations from using the same resource at exactly the same moment. Those are execution concerns and must not be allowed to redefine the product as a globally single-task system.

### 4.2 Workflows

A workflow is a persistent working environment for a recurring area or class of work.

The term **workflow** does not primarily mean a technical automation graph, DAG, or fixed sequence of steps. A Rove workflow represents a repeatable area of activity in which Rove benefits from knowing how the user wants that work performed.

A workflow can contain:

- its purpose and scope;
- relevant user context;
- preferences and selection criteria;
- operating guidance;
- reusable skills or procedures;
- rules and constraints;
- preferred ways of presenting results;
- relevant resources or artifacts;
- history and accumulated context where appropriate; and
- multiple tasks performed within that environment.

A workflow is therefore more than a folder of tasks. It is a **persistent working environment** the user can enter, work within, and return to. Its home brings together related independent tasks, useful structured outputs, and genuine task-owned attention while reusable context improves work in the background.

Creating that place must not require the user to configure its operating context first. A name is enough to create and enter a sparse workflow, and the user can immediately start a normal task inside it. Purpose, scope, preferences, criteria, procedures, resources, result conventions, and reusable knowledge are optional context edited later from a secondary surface.

The user should not need to be a prompt engineer to improve this context. Rove should eventually help by asking relevant questions, proposing configuration from the user's stated outcome or actual work, and presenting every durable suggestion for approval or editing. The resulting approved configuration acts as context engineering for the agents performing work inside that workflow; inference never silently becomes policy.

A workflow may evolve as the user refines what they want and as repeated work reveals better ways to perform it.

## 5. Tasks and Workflows Together

The relationship can be represented as:

```text
Rove
|
|-- Standalone Task
|-- Standalone Task
|
|-- Workflow: Job Search
|   |-- workflow context and guidance
|   |-- Task: Find relevant opportunities today
|   |-- Task: Review selected opportunities
|   |-- Task: Draft outreach for these roles
|   `-- Task: Follow up on previous outreach
|
`-- Workflow: GitHub Attention
    |-- repositories and attention criteria
    |-- review preferences and guidance
    |-- Task: What needs my attention today?
    `-- Task: Review this pull request
```

A useful analogy is that standalone tasks relate to workflows somewhat like standalone chats relate to projects in conversational products. The analogy stops at containment, however: a Rove workflow is intended to become an active, structured operating environment for repeated work, not merely a container for conversations and files.

## 6. Modes of Working

Rove supports different ways for the assistant and the human to participate in a task.

These modes describe **who is primarily performing the work and how control is shared**. They are not separate products.

### 6.1 Agent Mode

In Agent Mode, Rove is the primary executor.

The user gives Rove a task and Rove proceeds with the work using the capabilities available to it. When an action requires human judgment, human authentication, direct intervention, or another form of assistance, Rove can request the user's attention and hand control over.

After the human completes the required intervention and returns control, Rove should be able to continue from the resulting state rather than forcing the task to restart.

The intended experience is delegation with human intervention when needed.

### 6.2 Companion Mode

In Companion Mode, the user and Rove work more directly alongside one another.

Rove may be carrying out the task, but the user can take control when they want to inspect something, make a change, perform an action themselves, or temporarily lead the work. Rove pauses its own conflicting execution while the human has control.

When the user returns control, Rove continues with awareness of the state produced by the human's actions.

The intended experience is collaborative execution rather than a rigid handoff boundary.

### 6.3 Capture Mode

In Capture Mode, the human is the primary executor and Rove observes the work at a useful level so it can produce a record, summary, evidence, or other task-relevant output afterward.

For example, a user may say that they are going through several job sites and want Rove to keep track of where they looked and what they encountered. Rove can capture the meaningful journey and later return an organized record.

Capture Mode may also support narrowly useful technical evidence when appropriate, such as information needed to understand an error encountered during a browser task. It is not intended to turn Rove into a general-purpose observability or developer-tools platform.

The intended experience is human-led work with useful assistance derived from what Rove observed.

### 6.4 Participation Spectrum

```text
Primary executor

Rove ---------------------- Shared ---------------------- Human
  |                           |                            |
Agent Mode                Companion Mode              Capture Mode
```

The modes should make the relationship between human and assistant flexible. They should not create artificial product restrictions unrelated to the task itself.

## 7. Execution Capabilities

Rove performs tasks by using capabilities available to it.

The browser is the most important current capability because it enables Rove to perform work across web applications and websites without requiring a bespoke integration for every service.

Browser capability can include, where appropriate:

- navigation;
- inspection and understanding of visible application state;
- interaction with controls and content;
- reading and gathering information;
- completing multi-step web tasks;
- taking screenshots or preserving relevant evidence;
- working with the user through control handoffs; and
- continuing from state created by the user.

Over time, Rove may gain additional execution capabilities. Product architecture should therefore avoid defining Rove as equivalent to its browser implementation.

Execution capabilities answer **how Rove can perform work**. Tasks and workflows answer **what work the user is trying to accomplish and in what context**.

## 8. Example: Job Discovery and Outreach Workflow

One motivating use case for Rove is a recurring job-search process based on hiring posts rather than only formal job listings.

A user may know that relevant opportunities are often posted directly on LinkedIn by people saying they are hiring and including role information in the post. Finding these manually can require repeatedly searching combinations such as backend engineer, hiring, and remote; opening many posts; determining whether each role is relevant; identifying the person to contact; and then preparing an email or LinkedIn message with the appropriate résumé and outreach.

A Rove **Job Search** workflow could hold context such as:

- the user's background and seniority;
- role families they are interested in;
- roles or conditions they do not want;
- location and remote-work preferences;
- signals that make an opportunity strong or weak;
- preferred search approaches;
- résumé or portfolio resources;
- outreach style and message guidance; and
- how opportunities should be presented for review.

The user could then create a task such as:

> Find relevant hiring posts for today.

Rove could use the browser to perform the search, inspect candidate posts, filter them using the workflow's guidance, and return a useful set of opportunities.

The user could review those results and create or continue work such as:

- apply to selected opportunities;
- draft an email for a particular person;
- prepare a LinkedIn message;
- use the appropriate résumé;
- skip unsuitable roles; or
- revisit an opportunity later.

The value comes from the combination of **persistent workflow context + individual tasks + execution capability**, not from browser automation alone.

## 9. Example: GitHub Attention Task

A standalone task might be:

> Go through GitHub and find everything that needs my attention.

Rove could inspect relevant areas such as pull requests, issues, reviews, mentions, or other surfaced work, determine what appears actionable, and return an organized result.

This task does not require the user to create a GitHub workflow first. If the user later performs this kind of task repeatedly, they may choose to create a workflow containing repository context, priority rules, review preferences, and other guidance.

This illustrates an important product principle: **workflows enhance repeated work; they are not a prerequisite for useful tasks**.

## 10. Workflow Workspaces, Guidance, and Context Engineering

Repeated work becomes more useful when the assistant does not need to be re-taught the same operating context in every task.

Rove should therefore provide a first-class place to do recurring work and a secondary way to construct and maintain workflow guidance. Workflow Home prioritizes starting and continuing tasks, rediscovering useful structured outputs, and locating real attention needs. Outputs answer what useful things the work produced; tasks answer what work or conversation occurred. Context and settings improve the environment without becoming an entrance requirement.

The user experience should favor structured setup over requiring users to write elaborate system prompts. Depending on the workflow, Rove can ask questions such as:

- What kinds of outcomes are you looking for?
- What should Rove prioritize?
- What should it avoid?
- What information should it use when making a judgment?
- When should it ask before acting?
- How should results be organized?
- Are there reusable resources or artifacts relevant to this work?

Questions should be offered progressively after entry and adapted to the kind of work rather than presented as one mandatory universal creation form. Selectable answers should be used where they reduce unnecessary cognitive effort, with room for custom input, deferral, and indefinite use of a sparse workflow.

The resulting context should guide tasks inside the workflow automatically. The user should be able to inspect and refine it over time.

## 11. Multi-Task Product Behavior

Rove is not conceptually a single-task machine.

Users should be able to create multiple tasks, leave one task, move to another, and return later. Tasks may exist inside different workflows or independently.

The product should distinguish between:

- **task existence and availability**, which should be independent; and
- **temporary execution conflicts over a specific resource**, which may require coordination.

For example, two tasks should not both mutate the exact same browser page at the same instant. That does not justify blocking the creation, inspection, continuation, or unrelated execution of every other task in Rove.

Architectural concurrency and ownership mechanisms must serve this product behavior rather than imposing broader restrictions than the underlying resource actually requires.

## 12. MVP Direction

The current phase of Rove should establish the minimum product substrate needed to make the task-and-workflow model real and useful.

The MVP direction includes:

- standalone task creation;
- workflow creation;
- multiple tasks within a workflow;
- workflow-specific context and guidance;
- name-only workflow creation with immediate entry and ordinary task creation;
- progressive workflow context setup that does not require prompt-engineering expertise;
- workflow-level rediscovery of related tasks, structured outputs, and genuine task-owned attention;
- browser-backed execution for tasks that require web interaction;
- Agent Mode;
- Companion Mode;
- Capture Mode;
- reliable human takeover and return where applicable;
- useful, task-appropriate result presentation;
- independent task navigation and continuation without unnecessary global exclusivity; and
- enough persistence for Rove to preserve the working state and context expected by the product model.

This MVP is **not the final boundary of the product**.

Even after these capabilities exist, Rove will still be an early foundation for the broader product. The current work should be understood as building the substrate required to explore and develop that product, not as proving that Rove's eventual scope is limited to a browser-enabled equivalent of an existing chat or coding assistant.

## 13. Product Principles

### 13.1 Tasks and user outcomes come before infrastructure

Architecture exists to make Rove's task and workflow experience possible. Infrastructure terminology or current deployment topology must not become product semantics by accident.

### 13.2 The browser is a capability, not the product definition

Rove should be able to use the browser extensively without being reduced to a browser-automation product.

### 13.3 Workflows reduce repeated context-setting

A recurring area of work should become easier over time because the relevant context, preferences, guidance, and resources live with the workflow.

### 13.4 Users should not need to become prompt engineers

Rove should help users construct good operating context through product interaction, structured questions, and understandable controls.

### 13.5 Human control is first-class

Human intervention is not a failure state. Agent Mode, Companion Mode, and Capture Mode deliberately support different allocations of responsibility between Rove and the user.

### 13.6 Product-level freedom should not inherit unnecessary low-level locks

If a particular browser page, profile, or resource needs exclusive control, the restriction should remain scoped to that resource wherever possible. It should not automatically become a global restriction on tasks or workflows.

### 13.7 Workflows are living operating contexts

They should be able to accumulate and refine guidance as the user learns what works, instead of being immutable templates or fixed automation scripts.

### 13.8 Standalone work remains first-class

Rove should remain immediately useful for one-off tasks. Workflow structure is an enhancement for recurring work, not mandatory ceremony.

### 13.9 Results should match the work

A task may naturally produce a list, recommendation set, draft, record, evidence package, completed action, or follow-up decision. Rove should not force every task outcome into undifferentiated conversational text.

## 14. What Rove Is Not

Rove should not be defined as:

- a browser-automation product;
- a headed-browser runtime;
- a local execution node;
- a desktop-infrastructure product;
- a control-plane or device-connection product;
- a technical workflow/DAG engine;
- a container for prompts and files with no workflow behavior;
- a globally single-task assistant;
- a general-purpose browser observability system; or
- a product whose purpose is determined by the current architecture.

Some of these concepts may exist as implementation details or supporting capabilities. They are not Rove's product identity.

## 15. Product Vocabulary

### Rove

The product itself. There is no separate product concept called "Rove Hub" in this brief.

Existing repository references to a **Hub** should be treated as implementation terminology unless and until a separate product concept is intentionally defined in the future. They must not be used to infer a user-facing Rove Hub or to redefine Rove's purpose.

### Task

An individual piece of work performed with or by Rove. A task may be standalone or belong to a workflow.

### Workflow

A persistent operating environment for a recurring area of work, containing the context, guidance, preferences, resources, and tasks relevant to that work.

### Agent Mode

A task mode in which Rove is the primary executor and requests human intervention when needed.

### Companion Mode

A task mode in which Rove and the user work collaboratively, with control able to move between them during execution.

### Capture Mode

A task mode in which the human performs the work and Rove observes enough of the activity to produce useful task-related records, summaries, evidence, or assistance.

### Execution capability

A mechanism Rove can use to perform work, such as browser interaction. Execution capabilities support tasks; they do not define the product.

## 16. Early Product Success Criteria

The foundation is moving in the right direction when a user can:

- give Rove a meaningful standalone task and receive a useful outcome rather than merely instructions;
- create a recurring workflow whose context materially reduces repeated explanation;
- create multiple tasks inside and outside workflows without the product behaving as one globally locked session;
- allow Rove to perform browser-backed work while remaining able to intervene naturally;
- take control and return it without losing the continuity of the task;
- perform work themselves in Capture Mode and receive a useful record of what occurred;
- return to previous work with the context needed to continue; and
- understand Rove primarily in terms of the work it helps them accomplish, not the infrastructure used to execute it.

## 17. Architectural Consequence

From this point forward, architecture should be evaluated against the product rather than the product being inferred from the architecture.

A technical mechanism is justified when it enables or protects required product behavior. When an implementation choice creates a product restriction, the restriction should be examined to determine whether it is truly required by the product or is merely a consequence of the current design.

This is particularly important for task ownership, browser ownership, runtime/session relationships, persistence, concurrency, recovery, control handoff, and the boundaries between local and deployed components.

The current implementation is a starting substrate. Rove is the product.
