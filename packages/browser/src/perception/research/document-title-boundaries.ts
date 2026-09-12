import type { PageStateAssessment, PageStateKind } from "@rove/protocol";

import type { PropositionSet } from "../benchmark/types.js";

export interface Gate6ChallengeFDefinition {
  id: string;
  pair: string;
  description: string;
  title: string;
  body: string;
  expectedPrimaryState: PageStateKind;
  expectedPropositions: PropositionSet;
  criticality: "critical" | "standard";
  tags: string[];
}

function propositions(overrides: Partial<PropositionSet>): PropositionSet {
  return {
    primaryContentAvailable: false,
    documentUnstable: false,
    authenticationRequired: false,
    humanVerificationPresented: false,
    accessRestricted: false,
    errorPresented: false,
    interstitialPresented: false,
    ...overrides,
  };
}

export function challengeFDisposition(
  kind: PageStateKind,
): PageStateAssessment["recommendedAction"] {
  if (kind === "ready") {
    return "continue";
  }

  if (kind === "loading") {
    return "wait_and_inspect";
  }

  if (kind === "error") {
    return "stop";
  }

  return "request_human";
}

export const GATE6_CHALLENGE_F_CASES: Gate6ChallengeFDefinition[] = [
  {
    id: "confirmf-reference-brand-auth",
    pair: "reference-title-role",
    description:
      "Reference is a product-brand token here; an otherwise explicit credential gate must not be suppressed as documentation.",
    title: "Reference Labs",
    body: `
      <main>
        <h1>Sign in to continue</h1>
        <label>Email <input type="email" /></label>
        <label>Password <input type="password" /></label>
        <button>Sign in</button>
      </main>`,
    expectedPrimaryState: "authentication_required",
    expectedPropositions: propositions({
      authenticationRequired: true,
      interstitialPresented: true,
    }),
    criticality: "critical",
    tags: ["confirmatory-f", "metamorphic", "title-role", "authentication"],
  },
  {
    id: "confirmf-reference-document",
    pair: "reference-title-role",
    description:
      "Reference acts as the document type here, so failure terminology in the document remains descriptive rather than blocking.",
    title: "Authentication API Reference",
    body: `
      <main>
        <h1>Something went wrong responses</h1>
        <p>This reference documents expected error payloads.</p>
        <button>Next section</button>
      </main>`,
    expectedPrimaryState: "ready",
    expectedPropositions: propositions({
      primaryContentAvailable: true,
    }),
    criticality: "critical",
    tags: ["confirmatory-f", "metamorphic", "title-role", "documentation"],
  },
  {
    id: "confirmf-docs-brand-auth",
    pair: "docs-title-role",
    description:
      "Docs is part of a product brand here and must not suppress a real full-page authentication workflow.",
    title: "Docs Cloud",
    body: `
      <main>
        <h1>Welcome back</h1>
        <label>Email <input type="email" /></label>
        <label>Password <input type="password" /></label>
        <button>Continue</button>
      </main>`,
    expectedPrimaryState: "authentication_required",
    expectedPropositions: propositions({
      authenticationRequired: true,
      interstitialPresented: true,
    }),
    criticality: "critical",
    tags: ["confirmatory-f", "metamorphic", "title-role", "authentication"],
  },
  {
    id: "confirmf-docs-document",
    pair: "docs-title-role",
    description:
      "Docs is the page's document type here, so blocker-like terminology remains explanatory content.",
    title: "Payments Docs",
    body: `
      <main>
        <h1>Understanding access denied responses</h1>
        <p>These docs explain restriction handling for integrations.</p>
        <button>Next topic</button>
      </main>`,
    expectedPrimaryState: "ready",
    expectedPropositions: propositions({
      primaryContentAvailable: true,
    }),
    criticality: "critical",
    tags: ["confirmatory-f", "metamorphic", "title-role", "documentation"],
  },
  {
    id: "confirmf-tutorial-brand-auth",
    pair: "tutorial-title-role",
    description:
      "Tutorial is a company/product token here; the credential gate remains authentication.",
    title: "Tutorial Systems",
    body: `
      <main>
        <h1>Access your workspace</h1>
        <label>Username <input autocomplete="username" /></label>
        <label>Password <input type="password" /></label>
        <button>Sign in</button>
      </main>`,
    expectedPrimaryState: "authentication_required",
    expectedPropositions: propositions({
      authenticationRequired: true,
      interstitialPresented: true,
    }),
    criticality: "critical",
    tags: ["confirmatory-f", "metamorphic", "title-role", "authentication"],
  },
  {
    id: "confirmf-tutorial-document",
    pair: "tutorial-title-role",
    description:
      "Tutorial is the document type here and must prevent descriptive failure terminology from becoming a blocker.",
    title: "Account Recovery Tutorial",
    body: `
      <main>
        <h1>Something went wrong during recovery</h1>
        <p>This tutorial explains expected recovery failures.</p>
        <button>Continue tutorial</button>
      </main>`,
    expectedPrimaryState: "ready",
    expectedPropositions: propositions({
      primaryContentAvailable: true,
    }),
    criticality: "critical",
    tags: ["confirmatory-f", "metamorphic", "title-role", "documentation"],
  },
  {
    id: "confirmf-handbook-brand-auth",
    pair: "handbook-title-role",
    description:
      "Handbook is a brand token here; a clear credential wall must retain authentication semantics.",
    title: "Handbook AI",
    body: `
      <main>
        <h1>Sign in to continue</h1>
        <label>Email <input type="email" /></label>
        <label>Password <input type="password" /></label>
        <button>Sign in</button>
      </main>`,
    expectedPrimaryState: "authentication_required",
    expectedPropositions: propositions({
      authenticationRequired: true,
      interstitialPresented: true,
    }),
    criticality: "critical",
    tags: ["confirmatory-f", "metamorphic", "title-role", "authentication"],
  },
  {
    id: "confirmf-handbook-document",
    pair: "handbook-title-role",
    description:
      "Handbook is genuinely the document type here, so operational error wording is descriptive content.",
    title: "Operations Handbook",
    body: `
      <main>
        <h1>Application unavailable procedures</h1>
        <p>This handbook explains the operator response procedure.</p>
        <button>Continue reading</button>
      </main>`,
    expectedPrimaryState: "ready",
    expectedPropositions: propositions({
      primaryContentAvailable: true,
    }),
    criticality: "critical",
    tags: ["confirmatory-f", "metamorphic", "title-role", "documentation"],
  },
  {
    id: "confirmf-chapter-brand-auth",
    pair: "chapter-title-role",
    description:
      "Chapter is a product-name token here; title vocabulary alone must not suppress a clear login gate.",
    title: "Chapter Health",
    body: `
      <main>
        <h1>Sign in to continue</h1>
        <label>Email <input type="email" /></label>
        <label>Password <input type="password" /></label>
        <button>Sign in</button>
      </main>`,
    expectedPrimaryState: "authentication_required",
    expectedPropositions: propositions({
      authenticationRequired: true,
      interstitialPresented: true,
    }),
    criticality: "critical",
    tags: ["confirmatory-f", "metamorphic", "title-role", "authentication"],
  },
  {
    id: "confirmf-chapter-document",
    pair: "chapter-title-role",
    description:
      "Chapter is genuinely a structural document marker here and blocker terminology is explanatory.",
    title: "Chapter 4 - Error Recovery",
    body: `
      <main>
        <h1>Something went wrong</h1>
        <p>This chapter describes recovery behavior.</p>
        <button>Next chapter</button>
      </main>`,
    expectedPrimaryState: "ready",
    expectedPropositions: propositions({
      primaryContentAvailable: true,
    }),
    criticality: "critical",
    tags: ["confirmatory-f", "metamorphic", "title-role", "documentation"],
  },
  {
    id: "confirmf-readonly-local-restriction-alert",
    pair: "alert-ownership-without-controls",
    description:
      "A read-only primary article can remain fully available even when a local export alert is restrictive; absence of buttons alone must not make the alert page-blocking.",
    title: "Monthly report",
    body: `
      <main>
        <h1>Monthly report</h1>
        <article>
          <h2>Revenue summary</h2>
          <p>The complete report content is available for reading.</p>
          <p>Revenue increased across the reporting period.</p>
        </article>
      </main>
      <div role="alert">
        <p>Requests are temporarily limited for PDF export.</p>
      </div>`,
    expectedPrimaryState: "ready",
    expectedPropositions: propositions({
      primaryContentAvailable: true,
    }),
    criticality: "critical",
    tags: ["confirmatory-f", "metamorphic", "alert-ownership", "read-only"],
  },
  {
    id: "confirmf-blocking-restriction-alert",
    pair: "alert-ownership-without-controls",
    description:
      "The same restriction family owns the workflow when the primary surface itself says access is unavailable and contains no usable content.",
    title: "Monthly report",
    body: `
      <main>
        <h1>Monthly report unavailable</h1>
        <p>This report cannot currently be accessed.</p>
      </main>
      <div role="alert">
        <p>Requests are temporarily limited for this workspace.</p>
      </div>`,
    expectedPrimaryState: "access_restricted",
    expectedPropositions: propositions({
      accessRestricted: true,
      interstitialPresented: true,
    }),
    criticality: "critical",
    tags: ["confirmatory-f", "metamorphic", "alert-ownership", "blocking"],
  },
  {
    id: "confirmf-small-nonmodal-auth-dialog",
    pair: "dialog-blocking-property",
    description:
      "A small nonmodal role-dialog connection widget does not own the usable primary workflow even when it contains credentials.",
    title: "Workspace",
    body: `
      <main>
        <h1>Workspace</h1>
        <button>Open document</button>
      </main>
      <div role="dialog" style="width:220px;height:120px">
        <h2>Sign in to connect</h2>
        <label>Email <input type="email" /></label>
        <label>Password <input type="password" /></label>
      </div>`,
    expectedPrimaryState: "ready",
    expectedPropositions: propositions({
      primaryContentAvailable: true,
    }),
    criticality: "critical",
    tags: ["confirmatory-f", "metamorphic", "dialog", "nonmodal"],
  },
  {
    id: "confirmf-small-modal-auth-dialog",
    pair: "dialog-blocking-property",
    description:
      "Changing only modal ownership on the same small credential dialog must establish authentication.",
    title: "Workspace",
    body: `
      <main>
        <h1>Workspace</h1>
        <button>Open document</button>
      </main>
      <div role="dialog" aria-modal="true" style="width:220px;height:120px">
        <h2>Sign in to connect</h2>
        <label>Email <input type="email" /></label>
        <label>Password <input type="password" /></label>
      </div>`,
    expectedPrimaryState: "authentication_required",
    expectedPropositions: propositions({
      authenticationRequired: true,
      interstitialPresented: true,
    }),
    criticality: "critical",
    tags: ["confirmatory-f", "metamorphic", "dialog", "modal"],
  },
  {
    id: "confirmf-offscreen-verification-dialog",
    pair: "dialog-presentation",
    description:
      "A verification dialog positioned entirely outside the viewport is not currently presented to the user.",
    title: "Workspace",
    body: `
      <main>
        <h1>Workspace</h1>
        <button>Open project</button>
      </main>
      <div
        role="dialog"
        aria-modal="true"
        style="position:fixed;left:-2000px;top:-2000px;width:320px;height:160px"
      >
        <p>Verify you are human to continue.</p>
      </div>`,
    expectedPrimaryState: "ready",
    expectedPropositions: propositions({
      primaryContentAvailable: true,
    }),
    criticality: "critical",
    tags: ["confirmatory-f", "metamorphic", "presentation", "offscreen"],
  },
  {
    id: "confirmf-onscreen-verification-dialog",
    pair: "dialog-presentation",
    description:
      "Moving the same modal verification dialog into the viewport changes presentation and must establish verification.",
    title: "Workspace",
    body: `
      <main>
        <h1>Workspace</h1>
        <button>Open project</button>
      </main>
      <div
        role="dialog"
        aria-modal="true"
        style="position:fixed;left:40px;top:40px;width:320px;height:160px"
      >
        <p>Verify you are human to continue.</p>
      </div>`,
    expectedPrimaryState: "human_verification",
    expectedPropositions: propositions({
      humanVerificationPresented: true,
      interstitialPresented: true,
    }),
    criticality: "critical",
    tags: ["confirmatory-f", "metamorphic", "presentation", "onscreen"],
  },
  {
    id: "confirmf-doc-title-no-blocker",
    pair: "document-context-with-overlay",
    description:
      "A genuine reference page containing blocker terminology remains ready when no blocking surface is present.",
    title: "Browser API Reference",
    body: `
      <main>
        <h1>Human verification and authentication states</h1>
        <p>This reference documents verification and sign-in behavior.</p>
        <button>Next section</button>
      </main>`,
    expectedPrimaryState: "ready",
    expectedPropositions: propositions({
      primaryContentAvailable: true,
    }),
    criticality: "critical",
    tags: ["confirmatory-f", "metamorphic", "documentation", "no-overlay"],
  },
  {
    id: "confirmf-doc-title-verification-overlay",
    pair: "document-context-with-overlay",
    description:
      "A real blocking verification overlay above the same reference page must be classified independently from underlying documentation context.",
    title: "Browser API Reference",
    body: `
      <main>
        <h1>Human verification and authentication states</h1>
        <p>This reference documents verification and sign-in behavior.</p>
      </main>
      <div role="dialog" aria-modal="true">
        <p>Verify you are human to continue.</p>
        <button>Continue</button>
      </div>`,
    expectedPrimaryState: "human_verification",
    expectedPropositions: propositions({
      humanVerificationPresented: true,
      interstitialPresented: true,
    }),
    criticality: "critical",
    tags: [
      "confirmatory-f",
      "metamorphic",
      "documentation",
      "blocking-overlay",
    ],
  },
  {
    id: "confirmf-root-auth-with-brand-token",
    pair: "root-primary-title-role",
    description:
      "Without a main element, the body is primary and a Docs-branded credential wall must still establish authentication.",
    title: "Docs Works",
    body: `
      <div>
        <h1>Sign in to continue</h1>
        <label>Email <input type="email" /></label>
        <label>Password <input type="password" /></label>
        <button>Sign in</button>
      </div>`,
    expectedPrimaryState: "authentication_required",
    expectedPropositions: propositions({
      authenticationRequired: true,
      interstitialPresented: true,
    }),
    criticality: "critical",
    tags: ["confirmatory-f", "metamorphic", "root-primary", "authentication"],
  },
  {
    id: "confirmf-root-doc-with-doc-token",
    pair: "root-primary-title-role",
    description:
      "Without a main element, a genuine Docs document remains ready despite descriptive access-error terminology.",
    title: "Payments Docs",
    body: `
      <article>
        <h1>Access denied responses</h1>
        <p>These docs describe expected restriction payloads.</p>
      </article>`,
    expectedPrimaryState: "ready",
    expectedPropositions: propositions({
      primaryContentAvailable: true,
    }),
    criticality: "critical",
    tags: ["confirmatory-f", "metamorphic", "root-primary", "documentation"],
  },
];
