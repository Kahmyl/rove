import type { PageStateAssessment, PageStateKind } from "@rove/protocol";

import type { PropositionSet } from "../benchmark/types.js";

export interface Gate6ChallengeHDefinition {
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

export function challengeHDisposition(
  kind: PageStateKind,
): PageStateAssessment["recommendedAction"] {
  if (kind === "ready") return "continue";
  if (kind === "loading") return "wait_and_inspect";
  if (kind === "error") return "stop";
  return "request_human";
}

export const GATE6_CHALLENGE_H_CASES: Gate6ChallengeHDefinition[] = [
  {
    id: "confirmh-frame-before-main",
    pair: "document-frame-dom-order",
    description:
      "A presented verification frame preceding main in DOM order is still document-level blocking evidence.",
    title: "Workspace",
    body: `
      <iframe
        title="Security challenge"
        style="width:330px;height:150px"
        srcdoc="<button>Continue</button>"
      ></iframe>
      <main>
        <h1>Workspace</h1>
        <button>Open project</button>
      </main>`,
    expectedPrimaryState: "human_verification",
    expectedPropositions: props({
      humanVerificationPresented: true,
      interstitialPresented: true,
    }),
    criticality: "critical",
    tags: ["confirmatory-h", "metamorphic", "frame-order"],
  },
  {
    id: "confirmh-frame-after-main",
    pair: "document-frame-dom-order",
    description:
      "Moving the same verification frame after main must preserve document-level verification semantics.",
    title: "Workspace",
    body: `
      <main>
        <h1>Workspace</h1>
        <button>Open project</button>
      </main>
      <iframe
        title="Security challenge"
        style="width:330px;height:150px"
        srcdoc="<button>Continue</button>"
      ></iframe>`,
    expectedPrimaryState: "human_verification",
    expectedPropositions: props({
      humanVerificationPresented: true,
      interstitialPresented: true,
    }),
    criticality: "critical",
    tags: ["confirmatory-h", "metamorphic", "frame-order"],
  },

  {
    id: "confirmh-generic-visible-frame",
    pair: "semantic-frame-label",
    description:
      "A visible unowned generic iframe is not human-verification evidence merely because it is presented.",
    title: "Workspace",
    body: `
      <main>
        <h1>Workspace</h1>
        <button>Continue</button>
      </main>
      <div>
        <iframe
          title="Embedded support widget"
          style="width:330px;height:150px"
          srcdoc="<button>Open support</button>"
        ></iframe>
      </div>`,
    expectedPrimaryState: "ready",
    expectedPropositions: props({
      primaryContentAvailable: true,
    }),
    criticality: "critical",
    tags: ["confirmatory-h", "metamorphic", "semantic-label"],
  },
  {
    id: "confirmh-semantic-visible-frame",
    pair: "semantic-frame-label",
    description:
      "Changing the same visible unowned iframe to a verification semantic label establishes verification.",
    title: "Workspace",
    body: `
      <main>
        <h1>Workspace</h1>
        <button>Continue</button>
      </main>
      <div>
        <iframe
          title="Verify you are human"
          style="width:330px;height:150px"
          srcdoc="<button>Continue</button>"
        ></iframe>
      </div>`,
    expectedPrimaryState: "human_verification",
    expectedPropositions: props({
      humanVerificationPresented: true,
      interstitialPresented: true,
    }),
    criticality: "critical",
    tags: ["confirmatory-h", "metamorphic", "semantic-label"],
  },

  {
    id: "confirmh-supplementary-verification-frame",
    pair: "supplementary-vs-document-frame",
    description:
      "A verification-labelled iframe inside supplementary aside content does not own the primary workflow.",
    title: "Dashboard",
    body: `
      <main>
        <h1>Dashboard</h1>
        <button>Open report</button>
      </main>
      <aside>
        <h2>Integration preview</h2>
        <iframe
          title="Security challenge"
          style="width:330px;height:150px"
          srcdoc="<button>Continue</button>"
        ></iframe>
      </aside>`,
    expectedPrimaryState: "ready",
    expectedPropositions: props({
      primaryContentAvailable: true,
    }),
    criticality: "critical",
    tags: ["confirmatory-h", "metamorphic", "frame-ownership"],
  },
  {
    id: "confirmh-document-verification-frame",
    pair: "supplementary-vs-document-frame",
    description:
      "Moving the same verification frame out of supplementary ownership into a neutral document container makes presentation workflow-blocking.",
    title: "Dashboard",
    body: `
      <main>
        <h1>Dashboard</h1>
        <button>Open report</button>
      </main>
      <div>
        <h2>Continue</h2>
        <iframe
          title="Security challenge"
          style="width:330px;height:150px"
          srcdoc="<button>Continue</button>"
        ></iframe>
      </div>`,
    expectedPrimaryState: "human_verification",
    expectedPropositions: props({
      humanVerificationPresented: true,
      interstitialPresented: true,
    }),
    criticality: "critical",
    tags: ["confirmatory-h", "metamorphic", "frame-ownership"],
  },

  {
    id: "confirmh-transparent-verification-frame",
    pair: "frame-presentation-opacity",
    description:
      "A verification-labelled iframe with zero opacity is not currently presented.",
    title: "Workspace",
    body: `
      <main>
        <h1>Workspace</h1>
        <button>Continue</button>
      </main>
      <iframe
        title="Security challenge"
        style="width:330px;height:150px;opacity:0"
        srcdoc="<button>Continue</button>"
      ></iframe>`,
    expectedPrimaryState: "ready",
    expectedPropositions: props({
      primaryContentAvailable: true,
    }),
    criticality: "critical",
    tags: ["confirmatory-h", "metamorphic", "presentation"],
  },
  {
    id: "confirmh-opaque-verification-frame",
    pair: "frame-presentation-opacity",
    description:
      "Restoring opacity on the same verification frame establishes presentation.",
    title: "Workspace",
    body: `
      <main>
        <h1>Workspace</h1>
        <button>Continue</button>
      </main>
      <iframe
        title="Security challenge"
        style="width:330px;height:150px;opacity:1"
        srcdoc="<button>Continue</button>"
      ></iframe>`,
    expectedPrimaryState: "human_verification",
    expectedPropositions: props({
      humanVerificationPresented: true,
      interstitialPresented: true,
    }),
    criticality: "critical",
    tags: ["confirmatory-h", "metamorphic", "presentation"],
  },

  {
    id: "confirmh-primary-owned-verification-frame",
    pair: "surface-vs-document-frame-channel",
    description:
      "A verification frame inside the primary surface remains detectable through normal surface ownership.",
    title: "Workspace",
    body: `
      <main>
        <h1>Workspace</h1>
        <iframe
          title="Security challenge"
          style="width:330px;height:150px"
          srcdoc="<button>Continue</button>"
        ></iframe>
      </main>`,
    expectedPrimaryState: "human_verification",
    expectedPropositions: props({
      humanVerificationPresented: true,
      interstitialPresented: true,
    }),
    criticality: "critical",
    tags: ["confirmatory-h", "metamorphic", "ownership-channel"],
  },
  {
    id: "confirmh-document-owned-verification-frame",
    pair: "surface-vs-document-frame-channel",
    description:
      "Moving the same frame outside main preserves verification through the independent document-level ownership channel.",
    title: "Workspace",
    body: `
      <main>
        <h1>Workspace</h1>
      </main>
      <div>
        <iframe
          title="Security challenge"
          style="width:330px;height:150px"
          srcdoc="<button>Continue</button>"
        ></iframe>
      </div>`,
    expectedPrimaryState: "human_verification",
    expectedPropositions: props({
      humanVerificationPresented: true,
      interstitialPresented: true,
    }),
    criticality: "critical",
    tags: ["confirmatory-h", "metamorphic", "ownership-channel"],
  },

  {
    id: "confirmh-auth-only",
    pair: "verification-auth-precedence",
    description:
      "A structural credential gate without verification remains authentication-required.",
    title: "Workspace",
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
    tags: ["confirmatory-h", "metamorphic", "precedence"],
  },
  {
    id: "confirmh-auth-plus-document-verification",
    pair: "verification-auth-precedence",
    description:
      "Adding a presented document-level verification frame preserves authentication as a proposition but verification wins primary precedence.",
    title: "Workspace",
    body: `
      <main>
        <h1>Sign in to continue</h1>
        <label>Email <input type="email" /></label>
        <label>Password <input type="password" /></label>
        <button>Sign in</button>
      </main>
      <iframe
        title="Security challenge"
        style="width:330px;height:150px"
        srcdoc="<button>Continue</button>"
      ></iframe>`,
    expectedPrimaryState: "human_verification",
    expectedPropositions: props({
      authenticationRequired: true,
      humanVerificationPresented: true,
      interstitialPresented: true,
    }),
    criticality: "critical",
    tags: ["confirmatory-h", "metamorphic", "precedence"],
  },

  {
    id: "confirmh-http-error-only",
    pair: "verification-error-precedence",
    description:
      "A 503 response without stronger workflow evidence remains an error.",
    title: "Workspace",
    httpStatus: 503,
    body: `
      <main>
        <h1>Service temporarily unavailable</h1>
        <p>Please try again later.</p>
      </main>`,
    expectedPrimaryState: "error",
    expectedPropositions: props({
      errorPresented: true,
      interstitialPresented: true,
    }),
    criticality: "critical",
    tags: ["confirmatory-h", "metamorphic", "precedence"],
  },
  {
    id: "confirmh-http-error-plus-verification",
    pair: "verification-error-precedence",
    description:
      "A presented verification frame outranks simultaneous HTTP error evidence while both propositions remain true.",
    title: "Workspace",
    httpStatus: 503,
    body: `
      <main>
        <h1>Service temporarily unavailable</h1>
        <p>Please try again later.</p>
      </main>
      <iframe
        title="Security challenge"
        style="width:330px;height:150px"
        srcdoc="<button>Continue</button>"
      ></iframe>`,
    expectedPrimaryState: "human_verification",
    expectedPropositions: props({
      humanVerificationPresented: true,
      errorPresented: true,
      interstitialPresented: true,
    }),
    criticality: "critical",
    tags: ["confirmatory-h", "metamorphic", "precedence"],
  },

  {
    id: "confirmh-unrelated-first-verification-second",
    pair: "multiple-frame-ordinal-invariance",
    description:
      "A verification frame remains detectable when preceded by an unrelated iframe.",
    title: "Workspace",
    body: `
      <main>
        <h1>Workspace</h1>
        <button>Continue</button>
      </main>
      <iframe
        title="Embedded help"
        style="width:250px;height:100px"
        srcdoc="<p>Help</p>"
      ></iframe>
      <iframe
        title="Security challenge"
        style="width:330px;height:150px"
        srcdoc="<button>Continue</button>"
      ></iframe>`,
    expectedPrimaryState: "human_verification",
    expectedPropositions: props({
      humanVerificationPresented: true,
      interstitialPresented: true,
    }),
    criticality: "critical",
    tags: ["confirmatory-h", "metamorphic", "ordinal-mapping"],
  },
  {
    id: "confirmh-verification-first-unrelated-second",
    pair: "multiple-frame-ordinal-invariance",
    description:
      "Swapping the two iframe DOM ordinals must not break verification-to-geometry mapping.",
    title: "Workspace",
    body: `
      <main>
        <h1>Workspace</h1>
        <button>Continue</button>
      </main>
      <iframe
        title="Security challenge"
        style="width:330px;height:150px"
        srcdoc="<button>Continue</button>"
      ></iframe>
      <iframe
        title="Embedded help"
        style="width:250px;height:100px"
        srcdoc="<p>Help</p>"
      ></iframe>`,
    expectedPrimaryState: "human_verification",
    expectedPropositions: props({
      humanVerificationPresented: true,
      interstitialPresented: true,
    }),
    criticality: "critical",
    tags: ["confirmatory-h", "metamorphic", "ordinal-mapping"],
  },

  {
    id: "confirmh-unknown-modal-only",
    pair: "verification-unknown-precedence",
    description:
      "An unexplained blocking modal without known blocker semantics remains an unknown interstitial.",
    title: "Workspace",
    body: `
      <main>
        <h1>Workspace</h1>
        <button>Open project</button>
      </main>
      <div role="dialog" aria-modal="true">
        <h2>Before you continue</h2>
        <p>Additional action is required.</p>
        <button>Continue</button>
      </div>`,
    expectedPrimaryState: "unknown_interstitial",
    expectedPropositions: props({
      interstitialPresented: true,
    }),
    criticality: "critical",
    tags: ["confirmatory-h", "metamorphic", "precedence"],
  },
  {
    id: "confirmh-unknown-modal-plus-verification",
    pair: "verification-unknown-precedence",
    description:
      "A presented verification frame outranks a simultaneous unknown interstitial.",
    title: "Workspace",
    body: `
      <main>
        <h1>Workspace</h1>
        <button>Open project</button>
      </main>
      <div role="dialog" aria-modal="true">
        <h2>Before you continue</h2>
        <p>Additional action is required.</p>
        <button>Continue</button>
      </div>
      <iframe
        title="Security challenge"
        style="width:330px;height:150px"
        srcdoc="<button>Continue</button>"
      ></iframe>`,
    expectedPrimaryState: "human_verification",
    expectedPropositions: props({
      humanVerificationPresented: true,
      interstitialPresented: true,
    }),
    criticality: "critical",
    tags: ["confirmatory-h", "metamorphic", "precedence"],
  },
];
