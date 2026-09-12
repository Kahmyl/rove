import type { PageStateAssessment, PageStateKind } from "@rove/protocol";

import type { PropositionSet } from "../benchmark/types.js";

export interface Gate6ChallengeEDefinition {
  id: string;
  pair: string;
  description: string;
  title: string;
  body: string;
  httpStatus?: number;
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

export function challengeEDisposition(
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

export const GATE6_CHALLENGE_E_CASES: Gate6ChallengeEDefinition[] = [
  {
    id: "confirme-verification-footer",
    pair: "verification-text-surface",
    description:
      "The same verification directive is harmless in a supplementary footer when the primary workflow remains actionable.",
    title: "Workspace",
    body: `
      <main>
        <h1>Workspace</h1>
        <button>Open project</button>
      </main>
      <footer>
        <p>Verify you are human to continue.</p>
      </footer>`,
    expectedPrimaryState: "ready",
    expectedPropositions: propositions({
      primaryContentAvailable: true,
    }),
    criticality: "critical",
    tags: ["confirmatory-e", "metamorphic", "verification", "supplementary"],
  },
  {
    id: "confirme-verification-dialog",
    pair: "verification-text-surface",
    description:
      "Moving the same verification directive into a blocking dialog changes only its workflow ownership and must establish verification.",
    title: "Workspace",
    body: `
      <main>
        <h1>Workspace</h1>
        <button>Open project</button>
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
    tags: ["confirmatory-e", "metamorphic", "verification", "blocking-dialog"],
  },
  {
    id: "confirme-human-control-aside",
    pair: "verification-control-surface",
    description:
      "A human-verification-like checkbox inside an optional aside is not a workflow blocker.",
    title: "Form builder",
    body: `
      <main>
        <h1>Form builder</h1>
        <button>Publish</button>
      </main>
      <aside>
        <label><input type="checkbox" /> I am a human</label>
        <button>Run preview</button>
      </aside>`,
    expectedPrimaryState: "ready",
    expectedPropositions: propositions({
      primaryContentAvailable: true,
    }),
    criticality: "critical",
    tags: [
      "confirmatory-e",
      "metamorphic",
      "verification-control",
      "supplementary",
    ],
  },
  {
    id: "confirme-human-control-dialog",
    pair: "verification-control-surface",
    description:
      "The same human-verification-like control inside a blocking dialog must establish verification.",
    title: "Form builder",
    body: `
      <main>
        <h1>Form builder</h1>
        <button>Publish</button>
      </main>
      <div role="dialog" aria-modal="true">
        <label><input type="checkbox" /> I am a human</label>
        <button>Continue</button>
      </div>`,
    expectedPrimaryState: "human_verification",
    expectedPropositions: propositions({
      humanVerificationPresented: true,
      interstitialPresented: true,
    }),
    criticality: "critical",
    tags: [
      "confirmatory-e",
      "metamorphic",
      "verification-control",
      "blocking-dialog",
    ],
  },
  {
    id: "confirme-auth-aside",
    pair: "credential-surface",
    description:
      "A credential form embedded as an optional connection widget must not block an otherwise usable primary workflow.",
    title: "Reports",
    body: `
      <main>
        <h1>Reports</h1>
        <button>Open report</button>
      </main>
      <aside>
        <h2>Sign in to continue</h2>
        <label>Email <input type="email" /></label>
        <label>Password <input type="password" /></label>
        <button>Connect account</button>
      </aside>`,
    expectedPrimaryState: "ready",
    expectedPropositions: propositions({
      primaryContentAvailable: true,
    }),
    criticality: "critical",
    tags: ["confirmatory-e", "metamorphic", "authentication", "supplementary"],
  },
  {
    id: "confirme-auth-dialog",
    pair: "credential-surface",
    description:
      "Moving the same credential form into a blocking dialog must establish authentication.",
    title: "Reports",
    body: `
      <main>
        <h1>Reports</h1>
        <button>Open report</button>
      </main>
      <div role="dialog" aria-modal="true">
        <h2>Sign in to continue</h2>
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
    tags: [
      "confirmatory-e",
      "metamorphic",
      "authentication",
      "blocking-dialog",
    ],
  },
  {
    id: "confirme-restriction-section",
    pair: "restriction-surface",
    description:
      "Explicit restriction language inside a feature-level section remains local while the primary workflow is actionable.",
    title: "Editor",
    body: `
      <main>
        <h1>Editor</h1>
        <button>Save</button>
        <section>
          <h2>Export access is temporarily restricted</h2>
          <p>Editing remains available.</p>
        </section>
      </main>`,
    expectedPrimaryState: "ready",
    expectedPropositions: propositions({
      primaryContentAvailable: true,
    }),
    criticality: "critical",
    tags: ["confirmatory-e", "metamorphic", "restriction", "supplementary"],
  },
  {
    id: "confirme-restriction-root",
    pair: "restriction-surface",
    description:
      "The same restriction semantics as the whole document, with no main element, must establish workflow access restriction.",
    title: "Workspace",
    body: `
      <div>
        <h1>Workspace access is temporarily restricted</h1>
        <p>Your access to this workspace has been restricted.</p>
      </div>`,
    expectedPrimaryState: "access_restricted",
    expectedPropositions: propositions({
      accessRestricted: true,
      interstitialPresented: true,
    }),
    criticality: "critical",
    tags: ["confirmatory-e", "metamorphic", "restriction", "root"],
  },
  {
    id: "confirme-error-alert-active",
    pair: "error-alert-ownership",
    description:
      "A terminal-looking alert remains local when an actionable primary workflow clearly continues.",
    title: "Dashboard",
    body: `
      <main>
        <h1>Dashboard</h1>
        <button>Create item</button>
      </main>
      <div role="alert">
        <p>Something went wrong loading recommendations.</p>
      </div>`,
    expectedPrimaryState: "ready",
    expectedPropositions: propositions({
      primaryContentAvailable: true,
    }),
    criticality: "critical",
    tags: ["confirmatory-e", "metamorphic", "error", "alert"],
  },
  {
    id: "confirme-error-dialog",
    pair: "error-alert-ownership",
    description:
      "The same terminal error family inside a blocking dialog must establish a workflow error.",
    title: "Dashboard",
    body: `
      <main>
        <h1>Dashboard</h1>
        <button>Create item</button>
      </main>
      <div role="dialog" aria-modal="true">
        <h2>Something went wrong</h2>
        <p>The application cannot be displayed in this window.</p>
        <button>Close</button>
      </div>`,
    expectedPrimaryState: "error",
    expectedPropositions: propositions({
      errorPresented: true,
      interstitialPresented: true,
    }),
    criticality: "critical",
    tags: ["confirmatory-e", "metamorphic", "error", "blocking-dialog"],
  },
  {
    id: "confirme-restriction-alert-active",
    pair: "restriction-alert-ownership",
    description:
      "A restriction alert about one operation remains local while the primary workflow has an actionable control.",
    title: "Reports",
    body: `
      <main>
        <h1>Reports</h1>
        <button>Create report</button>
      </main>
      <div role="alert">
        <p>Requests are temporarily limited for export.</p>
      </div>`,
    expectedPrimaryState: "ready",
    expectedPropositions: propositions({
      primaryContentAvailable: true,
    }),
    criticality: "critical",
    tags: ["confirmatory-e", "metamorphic", "restriction", "alert"],
  },
  {
    id: "confirme-restriction-alert-blocking",
    pair: "restriction-alert-ownership",
    description:
      "With no actionable primary control, a restriction alert can own the blocked workflow and establish access restriction.",
    title: "Reports",
    body: `
      <main>
        <h1>Reports</h1>
        <p>Report access is currently unavailable.</p>
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
    tags: ["confirmatory-e", "metamorphic", "restriction", "alert"],
  },
  {
    id: "confirme-docs-error-primary",
    pair: "documentation-vs-blocker",
    description:
      "Error terminology on a clearly identified troubleshooting page is descriptive content rather than a blocker.",
    title: "Incident troubleshooting guide",
    body: `
      <main>
        <h1>Understanding Something went wrong messages</h1>
        <p>This guide explains how operators should interpret application failures.</p>
        <button>Open example</button>
      </main>`,
    expectedPrimaryState: "ready",
    expectedPropositions: propositions({
      primaryContentAvailable: true,
    }),
    criticality: "critical",
    tags: ["confirmatory-e", "metamorphic", "documentation", "error-negative"],
  },
  {
    id: "confirme-docs-error-dialog",
    pair: "documentation-vs-blocker",
    description:
      "A blocking terminal-error dialog above the same troubleshooting page is evaluated independently of documentation beneath it.",
    title: "Incident troubleshooting guide",
    body: `
      <main>
        <h1>Understanding Something went wrong messages</h1>
        <p>This guide explains how operators should interpret application failures.</p>
      </main>
      <div role="dialog" aria-modal="true">
        <h2>Application unavailable</h2>
        <p>The application cannot be displayed in this window.</p>
      </div>`,
    expectedPrimaryState: "error",
    expectedPropositions: propositions({
      errorPresented: true,
      interstitialPresented: true,
    }),
    criticality: "critical",
    tags: ["confirmatory-e", "metamorphic", "documentation", "blocking-dialog"],
  },
  {
    id: "confirme-guide-brand-auth",
    pair: "title-context-control",
    description:
      "A real authentication wall for a product whose brand contains a documentation word must not be suppressed by title context alone.",
    title: "Guide Cloud",
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
    tags: ["confirmatory-e", "metamorphic", "title-context", "authentication"],
  },
  {
    id: "confirme-guide-document",
    pair: "title-context-control",
    description:
      "A true troubleshooting guide using the same documentation word in its title must still suppress descriptive error terminology.",
    title: "Security Guide",
    body: `
      <main>
        <h1>Troubleshooting Something went wrong</h1>
        <p>This reference explains expected error handling behavior.</p>
        <button>Continue reading</button>
      </main>`,
    expectedPrimaryState: "ready",
    expectedPropositions: propositions({
      primaryContentAvailable: true,
    }),
    criticality: "critical",
    tags: ["confirmatory-e", "metamorphic", "title-context", "documentation"],
  },
  {
    id: "confirme-auth-nested-section",
    pair: "nested-boundary-auth",
    description:
      "A credential widget nested in a feature section remains supplementary and must not own the primary workflow.",
    title: "Workspace",
    body: `
      <main>
        <h1>Workspace</h1>
        <button>Open document</button>
        <section>
          <h2>Sign in to continue</h2>
          <label>Email <input type="email" /></label>
          <label>Password <input type="password" /></label>
          <button>Connect integration</button>
        </section>
      </main>`,
    expectedPrimaryState: "ready",
    expectedPropositions: propositions({
      primaryContentAvailable: true,
    }),
    criticality: "critical",
    tags: [
      "confirmatory-e",
      "metamorphic",
      "nested-boundary",
      "authentication",
    ],
  },
  {
    id: "confirme-auth-dialog-nested-section",
    pair: "nested-boundary-auth",
    description:
      "A blocking authentication dialog nested inside a feature section still owns the blocking surface independently.",
    title: "Workspace",
    body: `
      <main>
        <h1>Workspace</h1>
        <button>Open document</button>
        <section>
          <h2>Integration</h2>
          <div role="dialog" aria-modal="true">
            <h3>Sign in to continue</h3>
            <label>Email <input type="email" /></label>
            <label>Password <input type="password" /></label>
            <button>Sign in</button>
          </div>
        </section>
      </main>`,
    expectedPrimaryState: "authentication_required",
    expectedPropositions: propositions({
      authenticationRequired: true,
      interstitialPresented: true,
    }),
    criticality: "critical",
    tags: [
      "confirmatory-e",
      "metamorphic",
      "nested-boundary",
      "blocking-dialog",
    ],
  },
  {
    id: "confirme-hidden-verification-dialog",
    pair: "dialog-presentation",
    description:
      "A verification dialog that is present in the DOM but CSS-hidden is not a presented blocker.",
    title: "Workspace",
    body: `
      <main>
        <h1>Workspace</h1>
        <button>Open project</button>
      </main>
      <div role="dialog" aria-modal="true" style="display:none">
        <p>Verify you are human to continue.</p>
      </div>`,
    expectedPrimaryState: "ready",
    expectedPropositions: propositions({
      primaryContentAvailable: true,
    }),
    criticality: "critical",
    tags: ["confirmatory-e", "metamorphic", "presentation", "hidden"],
  },
  {
    id: "confirme-visible-verification-dialog",
    pair: "dialog-presentation",
    description:
      "Making the same verification dialog visible changes presentation and must establish the blocker.",
    title: "Workspace",
    body: `
      <main>
        <h1>Workspace</h1>
        <button>Open project</button>
      </main>
      <div role="dialog" aria-modal="true">
        <p>Verify you are human to continue.</p>
      </div>`,
    expectedPrimaryState: "human_verification",
    expectedPropositions: propositions({
      humanVerificationPresented: true,
      interstitialPresented: true,
    }),
    criticality: "critical",
    tags: ["confirmatory-e", "metamorphic", "presentation", "visible"],
  },
  {
    id: "confirme-unknown-aside",
    pair: "unknown-interstitial-surface",
    description:
      "Unknown consent-like content in a supplementary aside is not a workflow interstitial.",
    title: "Dashboard",
    body: `
      <main>
        <h1>Dashboard</h1>
        <button>Open workspace</button>
      </main>
      <aside>
        <h2>Review updated preferences</h2>
        <button>Review</button>
      </aside>`,
    expectedPrimaryState: "ready",
    expectedPropositions: propositions({
      primaryContentAvailable: true,
    }),
    criticality: "standard",
    tags: [
      "confirmatory-e",
      "metamorphic",
      "unknown-interstitial",
      "supplementary",
    ],
  },
  {
    id: "confirme-unknown-dialog",
    pair: "unknown-interstitial-surface",
    description:
      "Moving the same unknown consent-like content into a blocking dialog must produce an unknown interstitial.",
    title: "Dashboard",
    body: `
      <main>
        <h1>Dashboard</h1>
        <button>Open workspace</button>
      </main>
      <div role="dialog" aria-modal="true">
        <h2>Review updated preferences</h2>
        <button>Review</button>
      </div>`,
    expectedPrimaryState: "unknown_interstitial",
    expectedPropositions: propositions({
      interstitialPresented: true,
    }),
    criticality: "standard",
    tags: [
      "confirmatory-e",
      "metamorphic",
      "unknown-interstitial",
      "blocking-dialog",
    ],
  },
  {
    id: "confirme-overlap-verification-503",
    pair: "overlap-precedence",
    description:
      "Presented verification remains primary over an independent HTTP 503 error while preserving both propositions.",
    title: "Workspace",
    body: `
      <main>
        <h1>Workspace</h1>
      </main>
      <div role="dialog" aria-modal="true">
        <p>Verify you are human to continue.</p>
        <button>Continue</button>
      </div>`,
    httpStatus: 503,
    expectedPrimaryState: "human_verification",
    expectedPropositions: propositions({
      humanVerificationPresented: true,
      errorPresented: true,
      interstitialPresented: true,
    }),
    criticality: "critical",
    tags: ["confirmatory-e", "metamorphic", "overlap", "precedence"],
  },
  {
    id: "confirme-overlap-auth-451",
    pair: "overlap-precedence",
    description:
      "A blocking authentication surface remains primary over independent HTTP 451 restriction while preserving both propositions.",
    title: "Workspace",
    body: `
      <main>
        <h1>Workspace</h1>
      </main>
      <div role="dialog" aria-modal="true">
        <h2>Sign in to continue</h2>
        <label>Email <input type="email" /></label>
        <label>Password <input type="password" /></label>
        <button>Sign in</button>
      </div>`,
    httpStatus: 451,
    expectedPrimaryState: "authentication_required",
    expectedPropositions: propositions({
      authenticationRequired: true,
      accessRestricted: true,
      interstitialPresented: true,
    }),
    criticality: "critical",
    tags: ["confirmatory-e", "metamorphic", "overlap", "precedence"],
  },
];
