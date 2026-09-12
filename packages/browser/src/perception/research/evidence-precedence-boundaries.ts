import type { PageStateAssessment, PageStateKind } from "@rove/protocol";

import type { PropositionSet } from "../benchmark/types.js";

export interface Gate6ChallengeGDefinition {
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

function props(overrides: Partial<PropositionSet>): PropositionSet {
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

export function challengeGDisposition(
  kind: PageStateKind,
): PageStateAssessment["recommendedAction"] {
  if (kind === "ready") return "continue";
  if (kind === "loading") return "wait_and_inspect";
  if (kind === "error") return "stop";
  return "request_human";
}

export const GATE6_CHALLENGE_G_CASES: Gate6ChallengeGDefinition[] = [
  {
    id: "confirmg-reference-doc-copy",
    pair: "document-context-structural-auth",
    description:
      "A real reference document may describe authentication and failures without becoming a blocker.",
    title: "Payments Developer Reference",
    body: `
      <main>
        <h1>Authentication failures</h1>
        <p>This reference explains sign-in required and access denied responses.</p>
        <button>Next section</button>
      </main>`,
    expectedPrimaryState: "ready",
    expectedPropositions: props({
      primaryContentAvailable: true,
    }),
    criticality: "critical",
    tags: ["confirmatory-g", "metamorphic", "document-role"],
  },
  {
    id: "confirmg-reference-doc-with-real-gate",
    pair: "document-context-structural-auth",
    description:
      "The same document-shaped title cannot suppress a structural credential gate that owns the primary workflow.",
    title: "Payments Developer Reference",
    body: `
      <main>
        <h1>Sign in to continue</h1>
        <label>Email <input type="email" /></label>
        <label>Password <input type="password" /></label>
        <button>Sign in</button>
      </main>`,
    expectedPrimaryState: "authentication_required",
    expectedPropositions: props({
      authenticationRequired: true,
      interstitialPresented: true,
    }),
    criticality: "critical",
    tags: ["confirmatory-g", "metamorphic", "structural-auth"],
  },

  {
    id: "confirmg-settings-credential-edit",
    pair: "settings-vs-auth-workflow",
    description:
      "Credential fields inside an explicit settings workflow are not themselves an authentication gate.",
    title: "Account",
    body: `
      <main>
        <h1>Security settings</h1>
        <label>Email <input type="email" /></label>
        <label>Current password <input type="password" /></label>
        <button>Save changes</button>
      </main>`,
    expectedPrimaryState: "ready",
    expectedPropositions: props({
      primaryContentAvailable: true,
    }),
    criticality: "critical",
    tags: ["confirmatory-g", "metamorphic", "settings"],
  },
  {
    id: "confirmg-primary-credential-gate",
    pair: "settings-vs-auth-workflow",
    description:
      "Moving the same credential structure into a primary sign-in workflow establishes authentication.",
    title: "Account",
    body: `
      <main>
        <h1>Sign in required</h1>
        <label>Email <input type="email" /></label>
        <label>Password <input type="password" /></label>
        <button>Sign in</button>
      </main>`,
    expectedPrimaryState: "authentication_required",
    expectedPropositions: props({
      authenticationRequired: true,
      interstitialPresented: true,
    }),
    criticality: "critical",
    tags: ["confirmatory-g", "metamorphic", "structural-auth"],
  },

  {
    id: "confirmg-readonly-report-local-alert",
    pair: "alert-workflow-ownership",
    description:
      "A local restriction alert about export does not block a fully readable primary report, even with no primary controls.",
    title: "Quarterly report",
    body: `
      <main>
        <h1>Quarterly report</h1>
        <article>
          <h2>Revenue</h2>
          <p>The complete report is available to read.</p>
          <p>Revenue increased during the quarter.</p>
        </article>
      </main>
      <div role="alert">
        <p>Access is temporarily restricted for CSV export.</p>
      </div>`,
    expectedPrimaryState: "ready",
    expectedPropositions: props({
      primaryContentAvailable: true,
    }),
    criticality: "critical",
    tags: ["confirmatory-g", "metamorphic", "alert-ownership"],
  },
  {
    id: "confirmg-report-unavailable-alert",
    pair: "alert-workflow-ownership",
    description:
      "The same alert family becomes workflow-blocking when the primary surface independently says the report cannot be accessed.",
    title: "Quarterly report",
    body: `
      <main>
        <h1>Quarterly report unavailable</h1>
        <p>This report cannot currently be accessed.</p>
      </main>
      <div role="alert">
        <p>Access is temporarily restricted for this workspace.</p>
      </div>`,
    expectedPrimaryState: "access_restricted",
    expectedPropositions: props({
      accessRestricted: true,
      interstitialPresented: true,
    }),
    criticality: "critical",
    tags: ["confirmatory-g", "metamorphic", "alert-ownership"],
  },

  {
    id: "confirmg-readonly-alert-no-control",
    pair: "interaction-count-invariance",
    description:
      "Read-only primary content without controls remains usable despite a local operational alert.",
    title: "Status report",
    body: `
      <main>
        <h1>Status report</h1>
        <p>The complete status report is available here.</p>
      </main>
      <div role="alert">
        <p>Requests are temporarily limited for file downloads.</p>
      </div>`,
    expectedPrimaryState: "ready",
    expectedPropositions: props({
      primaryContentAvailable: true,
    }),
    criticality: "critical",
    tags: ["confirmatory-g", "metamorphic", "interaction-invariance"],
  },
  {
    id: "confirmg-readonly-alert-with-control",
    pair: "interaction-count-invariance",
    description:
      "Adding an unrelated primary control must not change ownership of the same local alert.",
    title: "Status report",
    body: `
      <main>
        <h1>Status report</h1>
        <p>The complete status report is available here.</p>
        <button>Print</button>
      </main>
      <div role="alert">
        <p>Requests are temporarily limited for file downloads.</p>
      </div>`,
    expectedPrimaryState: "ready",
    expectedPropositions: props({
      primaryContentAvailable: true,
    }),
    criticality: "critical",
    tags: ["confirmatory-g", "metamorphic", "interaction-invariance"],
  },

  {
    id: "confirmg-small-nonmodal-login",
    pair: "modal-ownership",
    description:
      "A small nonmodal connection dialog with credentials does not own the usable primary workflow.",
    title: "Workspace",
    body: `
      <main>
        <h1>Workspace</h1>
        <button>Open project</button>
      </main>
      <div role="dialog" style="width:220px;height:120px">
        <h2>Sign in to connect account</h2>
        <label>Email <input type="email" /></label>
        <label>Password <input type="password" /></label>
      </div>`,
    expectedPrimaryState: "ready",
    expectedPropositions: props({
      primaryContentAvailable: true,
    }),
    criticality: "critical",
    tags: ["confirmatory-g", "metamorphic", "dialog-ownership"],
  },
  {
    id: "confirmg-small-modal-login",
    pair: "modal-ownership",
    description:
      "Changing only modal ownership on the same credential dialog makes authentication workflow-blocking.",
    title: "Workspace",
    body: `
      <main>
        <h1>Workspace</h1>
        <button>Open project</button>
      </main>
      <div role="dialog" aria-modal="true" style="width:220px;height:120px">
        <h2>Sign in to connect account</h2>
        <label>Email <input type="email" /></label>
        <label>Password <input type="password" /></label>
      </div>`,
    expectedPrimaryState: "authentication_required",
    expectedPropositions: props({
      authenticationRequired: true,
      interstitialPresented: true,
    }),
    criticality: "critical",
    tags: ["confirmatory-g", "metamorphic", "dialog-ownership"],
  },

  {
    id: "confirmg-hidden-verification-frame",
    pair: "presentation",
    description:
      "A verification-labelled frame outside the viewport is provider/presence evidence, not current presentation.",
    title: "Workspace",
    body: `
      <main>
        <h1>Workspace</h1>
        <button>Continue</button>
      </main>
      <iframe
        title="Human verification"
        style="position:fixed;left:-3000px;top:-3000px;width:320px;height:140px"
        srcdoc="<button>Continue</button>"
      ></iframe>`,
    expectedPrimaryState: "ready",
    expectedPropositions: props({
      primaryContentAvailable: true,
    }),
    criticality: "critical",
    tags: ["confirmatory-g", "metamorphic", "presentation"],
  },
  {
    id: "confirmg-visible-verification-frame",
    pair: "presentation",
    description:
      "Moving the same verification frame into presentation establishes human verification.",
    title: "Workspace",
    body: `
      <main>
        <h1>Workspace</h1>
        <button>Continue</button>
      </main>
      <iframe
        title="Human verification"
        style="width:320px;height:140px"
        srcdoc="<button>Continue</button>"
      ></iframe>`,
    expectedPrimaryState: "human_verification",
    expectedPropositions: props({
      humanVerificationPresented: true,
      interstitialPresented: true,
    }),
    criticality: "critical",
    tags: ["confirmatory-g", "metamorphic", "presentation"],
  },

  {
    id: "confirmg-http-restriction-doc",
    pair: "http-auth-precedence",
    description:
      "An HTTP 429 establishes restriction when no stronger semantic workflow is present.",
    title: "Payments Docs",
    httpStatus: 429,
    body: `
      <main>
        <h1>Rate limits</h1>
        <p>This document explains request quotas.</p>
      </main>`,
    expectedPrimaryState: "access_restricted",
    expectedPropositions: props({
      accessRestricted: true,
      interstitialPresented: true,
    }),
    criticality: "critical",
    tags: ["confirmatory-g", "metamorphic", "http-precedence"],
  },
  {
    id: "confirmg-http-restriction-plus-auth",
    pair: "http-auth-precedence",
    description:
      "With the same HTTP restriction evidence, a structural authentication gate takes primary precedence while both propositions remain true.",
    title: "Payments Docs",
    httpStatus: 429,
    body: `
      <main>
        <h1>Sign in to continue</h1>
        <label>Email <input type="email" /></label>
        <label>Password <input type="password" /></label>
        <button>Sign in</button>
      </main>`,
    expectedPrimaryState: "authentication_required",
    expectedPropositions: props({
      authenticationRequired: true,
      accessRestricted: true,
      interstitialPresented: true,
    }),
    criticality: "critical",
    tags: ["confirmatory-g", "metamorphic", "http-precedence"],
  },

  {
    id: "confirmg-doc-supplementary-card",
    pair: "unknown-interstitial-ownership",
    description:
      "An unexplained supplementary card on a document does not become a blocking unknown interstitial.",
    title: "Integration Reference",
    body: `
      <main>
        <h1>Integration Reference</h1>
        <p>Complete API documentation is available.</p>
      </main>
      <aside>
        <h2>Before you continue</h2>
        <p>Additional information is available here.</p>
      </aside>`,
    expectedPrimaryState: "ready",
    expectedPropositions: props({
      primaryContentAvailable: true,
    }),
    criticality: "critical",
    tags: ["confirmatory-g", "metamorphic", "unknown-ownership"],
  },
  {
    id: "confirmg-doc-unknown-modal",
    pair: "unknown-interstitial-ownership",
    description:
      "The same unexplained intervening content becomes an unknown interstitial when it owns a blocking modal surface.",
    title: "Integration Reference",
    body: `
      <main>
        <h1>Integration Reference</h1>
        <p>Complete API documentation is available.</p>
      </main>
      <div role="dialog" aria-modal="true">
        <h2>Before you continue</h2>
        <p>Additional information is required.</p>
        <button>Continue</button>
      </div>`,
    expectedPrimaryState: "unknown_interstitial",
    expectedPropositions: props({
      interstitialPresented: true,
    }),
    criticality: "critical",
    tags: ["confirmatory-g", "metamorphic", "unknown-ownership"],
  },
];
