import type { PageStateAssessment, PageStateKind } from "@rove/protocol";

import type { PropositionSet } from "../benchmark/types.js";

export interface Gate6ChallengeDDefinition {
  id: string;
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

export function challengeDDisposition(
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

export const GATE6_CHALLENGE_D_CASES: Gate6ChallengeDDefinition[] = [
  {
    id: "confirmd-ready-footer-verification-sample",
    description:
      "Exact verification imperative appears in a nonblocking sample footer while the intended workflow remains fully usable.",
    title: "Operations handbook",
    body: `
      <main>
        <h1>Operations handbook</h1>
        <p>The current workflow is available.</p>
        <button>Open workspace</button>
      </main>
      <footer>
        <p>Verify you are human to continue.</p>
        <small>Sample support copy only; no action is required on this page.</small>
      </footer>`,
    expectedPrimaryState: "ready",
    expectedPropositions: propositions({
      primaryContentAvailable: true,
    }),
    criticality: "critical",
    tags: ["confirmatory-d", "ready", "verification-negative", "surface-scope"],
  },
  {
    id: "confirmd-ready-optional-signin-sidebar",
    description:
      "An optional sign-in card must not turn an otherwise usable application into an authentication wall.",
    title: "Analytics",
    body: `
      <main>
        <h1>Analytics dashboard</h1>
        <button>Refresh report</button>
      </main>
      <aside>
        <h2>Sign in to continue</h2>
        <p>Connect an optional reporting account. The dashboard remains available.</p>
        <button>Connect later</button>
      </aside>`,
    expectedPrimaryState: "ready",
    expectedPropositions: propositions({
      primaryContentAvailable: true,
    }),
    criticality: "critical",
    tags: [
      "confirmatory-d",
      "ready",
      "authentication-negative",
      "surface-scope",
    ],
  },
  {
    id: "confirmd-ready-partial-restriction-card",
    description:
      "A feature-level restriction inside a usable primary workflow is not whole-workflow access restriction.",
    title: "Workspace",
    body: `
      <main>
        <h1>Workspace</h1>
        <button>Save document</button>
        <button>Open history</button>
        <section>
          <h2>Export access is temporarily restricted</h2>
          <p>You can keep editing and saving while exports are unavailable.</p>
        </section>
      </main>`,
    expectedPrimaryState: "ready",
    expectedPropositions: propositions({
      primaryContentAvailable: true,
    }),
    criticality: "critical",
    tags: [
      "confirmatory-d",
      "ready",
      "restriction-negative",
      "partial-feature",
    ],
  },
  {
    id: "confirmd-ready-local-error-card",
    description:
      "A failed secondary widget inside a usable primary workflow is not a page-level terminal error.",
    title: "Project home",
    body: `
      <main>
        <h1>Project home</h1>
        <button>Create task</button>
        <button>Open board</button>
        <section>
          <h2>Something went wrong</h2>
          <p>Recommendations could not load. Your project is still available.</p>
        </section>
      </main>`,
    expectedPrimaryState: "ready",
    expectedPropositions: propositions({
      primaryContentAvailable: true,
    }),
    criticality: "critical",
    tags: ["confirmatory-d", "ready", "error-negative", "partial-feature"],
  },
  {
    id: "confirmd-ready-passkey-settings",
    description:
      "Passkey-management controls inside security settings are not an authentication gate.",
    title: "Security settings",
    body: `
      <main>
        <h1>Security settings</h1>
        <p>Test the passkey registered to your account before saving changes.</p>
        <button>Use passkey</button>
        <button>Save settings</button>
      </main>`,
    expectedPrimaryState: "ready",
    expectedPropositions: propositions({
      primaryContentAvailable: true,
    }),
    criticality: "critical",
    tags: ["confirmatory-d", "ready", "passkey-negative", "settings"],
  },
  {
    id: "confirmd-auth-modal-over-settings",
    description:
      "A blocking credential dialog remains authentication even when the underlying page is security settings.",
    title: "Security settings",
    body: `
      <main>
        <h1>Security settings</h1>
        <button>Save preferences</button>
      </main>
      <div role="dialog" aria-modal="true">
        <h2>Session expired</h2>
        <p>Authenticate to continue.</p>
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
    tags: ["confirmatory-d", "authentication", "settings", "modal"],
  },
  {
    id: "confirmd-auth-modal-over-docs",
    description:
      "A real blocking sign-in dialog remains authentication even when the underlying document is documentation.",
    title: "Integration guide",
    body: `
      <main>
        <h1>Integration guide</h1>
        <p>Provider setup documentation.</p>
      </main>
      <div role="dialog" aria-modal="true">
        <h2>Sign in to continue</h2>
        <label>Email <input type="email" /></label>
        <label>Password <input type="password" /></label>
        <button>Continue</button>
      </div>`,
    expectedPrimaryState: "authentication_required",
    expectedPropositions: propositions({
      authenticationRequired: true,
      interstitialPresented: true,
    }),
    criticality: "critical",
    tags: ["confirmatory-d", "authentication", "documentation", "modal"],
  },
  {
    id: "confirmd-verification-modal-over-docs",
    description:
      "A presented human-verification dialog remains verification even when the underlying document is documentation.",
    title: "Verification integration guide",
    body: `
      <main>
        <h1>Verification integration guide</h1>
        <p>Documentation remains underneath the active blocker.</p>
      </main>
      <div role="dialog" aria-modal="true">
        <h2>Additional check</h2>
        <label><input type="checkbox" /> I am a human</label>
        <button>Continue</button>
      </div>`,
    expectedPrimaryState: "human_verification",
    expectedPropositions: propositions({
      humanVerificationPresented: true,
      interstitialPresented: true,
    }),
    criticality: "critical",
    tags: ["confirmatory-d", "human-verification", "documentation", "modal"],
  },
  {
    id: "confirmd-restriction-modal-over-app",
    description:
      "A blocking access-suspension dialog prevents the workflow and must establish access restriction.",
    title: "Team workspace",
    body: `
      <main>
        <h1>Team workspace</h1>
        <button>Open project</button>
      </main>
      <div role="dialog" aria-modal="true">
        <h2>Workspace suspended</h2>
        <p>Your access to this workspace has been suspended.</p>
        <button>Contact administrator</button>
      </div>`,
    expectedPrimaryState: "access_restricted",
    expectedPropositions: propositions({
      accessRestricted: true,
      interstitialPresented: true,
    }),
    criticality: "critical",
    tags: ["confirmatory-d", "access-restricted", "modal", "surface-scope"],
  },
  {
    id: "confirmd-error-modal-over-app",
    description:
      "A blocking terminal failure dialog prevents the workflow and must establish an error.",
    title: "Editor",
    body: `
      <main>
        <h1>Editor</h1>
        <button>Open document</button>
      </main>
      <div role="dialog" aria-modal="true">
        <h2>Cannot open workspace</h2>
        <p>The application cannot continue in this window.</p>
        <button>Close</button>
      </div>`,
    expectedPrimaryState: "error",
    expectedPropositions: propositions({
      errorPresented: true,
      interstitialPresented: true,
    }),
    criticality: "critical",
    tags: ["confirmatory-d", "error", "modal", "surface-scope"],
  },
  {
    id: "confirmd-auth-account-dialog-over-app",
    description:
      "A blocking account chooser over an application is an authentication continuation surface.",
    title: "Reports",
    body: `
      <main>
        <h1>Reports</h1>
        <button>Open report</button>
      </main>
      <div role="dialog" aria-modal="true">
        <h2>Choose an account</h2>
        <button>Personal account</button>
        <button>Work account</button>
      </div>`,
    expectedPrimaryState: "authentication_required",
    expectedPropositions: propositions({
      authenticationRequired: true,
      interstitialPresented: true,
    }),
    criticality: "critical",
    tags: ["confirmatory-d", "authentication", "account-chooser", "modal"],
  },
  {
    id: "confirmd-ready-human-control-card",
    description:
      "Human/robot vocabulary in an ordinary nonblocking control card must not establish verification.",
    title: "Form builder",
    body: `
      <main>
        <h1>Form builder</h1>
        <button>Publish form</button>
      </main>
      <aside>
        <label><input type="checkbox" /> I am a human</label>
        <button>Run demo</button>
      </aside>`,
    expectedPrimaryState: "ready",
    expectedPropositions: propositions({
      primaryContentAvailable: true,
    }),
    criticality: "critical",
    tags: ["confirmatory-d", "ready", "verification-negative", "control"],
  },
  {
    id: "confirmd-ready-restriction-alert-with-live-workflow",
    description:
      "A bounded restriction alert about one operation remains nonblocking when the primary workflow is still actionable.",
    title: "Reports",
    body: `
      <main>
        <h1>Reports</h1>
        <button>Create report</button>
        <button>Open saved report</button>
      </main>
      <div role="alert">Requests are temporarily limited for report export.</div>`,
    expectedPrimaryState: "ready",
    expectedPropositions: propositions({
      primaryContentAvailable: true,
    }),
    criticality: "critical",
    tags: ["confirmatory-d", "ready", "restriction-negative", "alert"],
  },
  {
    id: "confirmd-ready-error-alert-with-live-workflow",
    description:
      "A bounded error alert about one widget remains nonblocking while the primary workflow is actionable.",
    title: "Activity",
    body: `
      <main>
        <h1>Activity</h1>
        <button>Create item</button>
        <button>Open archive</button>
      </main>
      <div role="alert">Something went wrong loading the activity feed.</div>`,
    expectedPrimaryState: "ready",
    expectedPropositions: propositions({
      primaryContentAvailable: true,
    }),
    criticality: "critical",
    tags: ["confirmatory-d", "ready", "error-negative", "alert"],
  },
  {
    id: "confirmd-restriction-root-surface",
    description:
      "A whole-document restriction surface does not require a main or alert role to be semantically blocking.",
    title: "Workspace suspended",
    body: `
      <div>
        <h1>Workspace access suspended</h1>
        <p>Your access to this workspace has been suspended.</p>
      </div>`,
    expectedPrimaryState: "access_restricted",
    expectedPropositions: propositions({
      accessRestricted: true,
      interstitialPresented: true,
    }),
    criticality: "critical",
    tags: ["confirmatory-d", "access-restricted", "root-surface"],
  },
  {
    id: "confirmd-error-root-surface",
    description:
      "A whole-document terminal failure does not require a main or alert role to be semantically blocking.",
    title: "Application unavailable",
    body: `
      <div>
        <h1>Application unavailable</h1>
        <p>The application cannot be displayed in this browser window.</p>
      </div>`,
    expectedPrimaryState: "error",
    expectedPropositions: propositions({
      errorPresented: true,
      interstitialPresented: true,
    }),
    criticality: "critical",
    tags: ["confirmatory-d", "error", "root-surface"],
  },
  {
    id: "confirmd-auth-example-company",
    description:
      "A real authentication wall for a company whose name contains Example must not be suppressed as documentation.",
    title: "Example Security",
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
    tags: ["confirmatory-d", "authentication", "meta-negative-control"],
  },
  {
    id: "confirmd-auth-demo-company",
    description:
      "A real authentication wall for a product whose name contains Demo must not be suppressed as demonstration content.",
    title: "Demo Systems",
    body: `
      <main>
        <h1>Unlock your account</h1>
        <label>Username <input autocomplete="username" /></label>
        <label>Password <input type="password" /></label>
        <button>Unlock</button>
      </main>`,
    expectedPrimaryState: "authentication_required",
    expectedPropositions: propositions({
      authenticationRequired: true,
      interstitialPresented: true,
    }),
    criticality: "critical",
    tags: ["confirmatory-d", "authentication", "meta-negative-control"],
  },
  {
    id: "confirmd-overlap-auth-restriction-settings",
    description:
      "A blocking authentication dialog over settings during an HTTP restriction preserves both propositions with authentication primary.",
    title: "Security settings",
    body: `
      <main>
        <h1>Security settings</h1>
        <button>Save changes</button>
      </main>
      <div role="dialog" aria-modal="true">
        <h2>Session expired</h2>
        <label>Email <input type="email" /></label>
        <label>Password <input type="password" /></label>
        <button>Sign in</button>
      </div>`,
    httpStatus: 429,
    expectedPrimaryState: "authentication_required",
    expectedPropositions: propositions({
      authenticationRequired: true,
      accessRestricted: true,
      interstitialPresented: true,
    }),
    criticality: "critical",
    tags: ["confirmatory-d", "overlap", "authentication", "access-restricted"],
  },
  {
    id: "confirmd-unknown-terms-dialog",
    description:
      "A blocking modal with no established known blocker semantics remains an unknown interstitial.",
    title: "Dashboard",
    body: `
      <main>
        <h1>Dashboard</h1>
        <button>Open workspace</button>
      </main>
      <div role="dialog" aria-modal="true">
        <h2>Review updated terms</h2>
        <p>Please review the updated terms before continuing.</p>
        <button>Accept</button>
      </div>`,
    expectedPrimaryState: "unknown_interstitial",
    expectedPropositions: propositions({
      interstitialPresented: true,
    }),
    criticality: "standard",
    tags: ["confirmatory-d", "unknown-interstitial", "modal"],
  },
];
