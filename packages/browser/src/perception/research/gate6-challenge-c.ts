import type { PageStateKind, PageStateRecommendedAction } from "@rove/protocol";

import type {
  BenchmarkCriticality,
  PropositionSet,
} from "../benchmark/types.js";

export interface Gate6ChallengeCDefinition {
  id: string;
  description: string;
  title: string;
  body: string;
  expectedPrimaryState: PageStateKind;
  expectedPropositions: PropositionSet;
  criticality: BenchmarkCriticality;
  tags: string[];
  httpStatus?: number;
}

const DEFAULT_PROPOSITIONS: PropositionSet = {
  primaryContentAvailable: false,
  documentUnstable: false,
  authenticationRequired: false,
  humanVerificationPresented: false,
  accessRestricted: false,
  errorPresented: false,
  interstitialPresented: false,
};

function propositions(overrides: Partial<PropositionSet>): PropositionSet {
  return {
    ...DEFAULT_PROPOSITIONS,
    ...overrides,
  };
}

export function challengeCDisposition(
  state: PageStateKind,
): PageStateRecommendedAction {
  switch (state) {
    case "ready":
      return "continue";
    case "loading":
      return "wait_and_inspect";
    case "error":
      return "stop";
    case "authentication_required":
    case "human_verification":
    case "access_restricted":
    case "unknown_interstitial":
      return "request_human";
  }
}

export const GATE6_CHALLENGE_C_CASES: Gate6ChallengeCDefinition[] = [
  {
    id: "confirmc-ready-example-imperative-heading",
    description:
      "Quoted/example blocker language in documentation must remain ordinary content.",
    title: "Integration examples",
    body: `
      <main>
        <h1>Example: “Complete the CAPTCHA to continue”</h1>
        <p>This chapter documents copy used by an integration test.</p>
        <a href="#next">Next example</a>
      </main>`,
    expectedPrimaryState: "ready",
    expectedPropositions: propositions({
      primaryContentAvailable: true,
    }),
    criticality: "critical",
    tags: ["confirmatory-c", "ready", "meta-language", "verification-negative"],
  },
  {
    id: "confirmc-ready-demo-directive-near-iframe",
    description:
      "A documentation demo contains challenge-like copy beside a visible demo iframe but is not an active blocker.",
    title: "Widget demo",
    body: `
      <article>
        <h1>Embedded widget example</h1>
        <p>Verify you are human to continue.</p>
        <iframe
          title="Demo widget"
          style="width:360px;height:160px"
          srcdoc="<!doctype html><html><body><p>Example surface</p></body></html>"
        ></iframe>
        <p>The text and frame above are documentation examples.</p>
      </article>`,
    expectedPrimaryState: "ready",
    expectedPropositions: propositions({
      primaryContentAvailable: true,
    }),
    criticality: "critical",
    tags: ["confirmatory-c", "ready", "locality-negative", "iframe"],
  },
  {
    id: "confirmc-ready-save-error-toast",
    description:
      "A non-blocking operation error toast must not turn an otherwise usable application into a page error.",
    title: "Editor",
    body: `
      <main>
        <h1>Document editor</h1>
        <textarea>Draft remains editable</textarea>
        <button>Save again</button>
      </main>
      <div role="alert" style="position:fixed;right:20px;bottom:20px">
        Something went wrong saving the draft. Try again.
      </div>`,
    expectedPrimaryState: "ready",
    expectedPropositions: propositions({
      primaryContentAvailable: true,
    }),
    criticality: "critical",
    tags: ["confirmatory-c", "ready", "error-negative", "nonblocking-alert"],
  },
  {
    id: "confirmc-ready-plan-limit-alert",
    description:
      "A product-plan limit banner is not a workflow-wide access restriction.",
    title: "Dashboard",
    body: `
      <main>
        <h1>Workspace dashboard</h1>
        <button>Open project</button>
      </main>
      <div role="alert">
        Resource access is limited on the free plan; upgrade for larger exports.
      </div>`,
    expectedPrimaryState: "ready",
    expectedPropositions: propositions({
      primaryContentAvailable: true,
    }),
    criticality: "critical",
    tags: ["confirmatory-c", "ready", "restriction-negative", "product-limit"],
  },
  {
    id: "confirmc-ready-account-security-form",
    description:
      "An account-settings form may contain email and current-password controls without being an authentication wall.",
    title: "Security settings",
    body: `
      <main>
        <h1>Security settings</h1>
        <nav><a href="#profile">Profile</a><a href="#billing">Billing</a></nav>
        <p>Update the email used for account notices.</p>
        <label>Email <input type="email" value="user@example.test" /></label>
        <label>Current password <input type="password" /></label>
        <button>Save settings</button>
      </main>`,
    expectedPrimaryState: "ready",
    expectedPropositions: propositions({
      primaryContentAvailable: true,
    }),
    criticality: "critical",
    tags: [
      "confirmatory-c",
      "ready",
      "authentication-negative",
      "settings-form",
    ],
  },
  {
    id: "confirmc-ready-hidden-verification-directive",
    description: "Hidden directive text is not presented verification.",
    title: "Article",
    body: `
      <h1 style="display:none">Verify you are human to continue</h1>
      <main><h2>Article</h2><p>Visible content remains available.</p></main>`,
    expectedPrimaryState: "ready",
    expectedPropositions: propositions({
      primaryContentAvailable: true,
    }),
    criticality: "critical",
    tags: ["confirmatory-c", "ready", "hidden", "verification-negative"],
  },
  {
    id: "confirmc-ready-hidden-semantic-frame-visible-ordinary",
    description:
      "A hidden semantic verification frame must not contaminate a separate ordinary visible iframe.",
    title: "Report",
    body: `
      <main><h1>Report</h1><p>Current report content.</p></main>
      <iframe
        title="Human verification"
        style="display:none;width:300px;height:100px"
        srcdoc="<!doctype html><html><body></body></html>"
      ></iframe>
      <iframe
        title="Chart preview"
        style="width:400px;height:180px"
        srcdoc="<!doctype html><html><body><p>Chart</p></body></html>"
      ></iframe>`,
    expectedPrimaryState: "ready",
    expectedPropositions: propositions({
      primaryContentAvailable: true,
    }),
    criticality: "critical",
    tags: ["confirmatory-c", "ready", "frame-identity", "visibility"],
  },
  {
    id: "confirmc-verification-paragraph-only",
    description:
      "A stable full-page verification instruction can be presented in ordinary text without an iframe or heading.",
    title: "Additional check",
    body: `
      <main>
        <p>Verify you are human to continue.</p>
        <button>Continue</button>
      </main>`,
    expectedPrimaryState: "human_verification",
    expectedPropositions: propositions({
      humanVerificationPresented: true,
      interstitialPresented: true,
    }),
    criticality: "critical",
    tags: ["confirmatory-c", "human-verification", "paragraph-only"],
  },
  {
    id: "confirmc-verification-dialog-control",
    description:
      "A blocking dialog with a verification-specific control is direct verification evidence.",
    title: "Check",
    body: `
      <div role="dialog" aria-modal="true" style="position:fixed;inset:0;background:white">
        <p>Confirm you are human before proceeding.</p>
        <label><input type="checkbox" /> I am a human</label>
        <button>Continue</button>
      </div>`,
    expectedPrimaryState: "human_verification",
    expectedPropositions: propositions({
      humanVerificationPresented: true,
      interstitialPresented: true,
    }),
    criticality: "critical",
    tags: ["confirmatory-c", "human-verification", "dialog-control"],
  },
  {
    id: "confirmc-verification-rich-paragraph-only",
    description:
      "Rich underlying content remains available while a paragraph-level verification blocker is presented.",
    title: "Account",
    body: `
      <main>
        <p>${"Account information, settings, preferences, and history. ".repeat(18)}</p>
        <p>Verify you are human before continuing to account actions.</p>
      </main>`,
    expectedPrimaryState: "human_verification",
    expectedPropositions: propositions({
      primaryContentAvailable: true,
      humanVerificationPresented: true,
      interstitialPresented: true,
    }),
    criticality: "critical",
    tags: [
      "confirmatory-c",
      "human-verification",
      "rich-content",
      "paragraph-only",
    ],
  },
  {
    id: "confirmc-auth-passkey-wall",
    description:
      "A passkey-only full-page identity wall requires authentication without credential inputs.",
    title: "Continue securely",
    body: `
      <main>
        <h1>Continue with your passkey</h1>
        <p>Use the passkey registered to this account.</p>
        <button>Use passkey</button>
      </main>`,
    expectedPrimaryState: "authentication_required",
    expectedPropositions: propositions({
      authenticationRequired: true,
      interstitialPresented: true,
    }),
    criticality: "critical",
    tags: ["confirmatory-c", "authentication", "passkey"],
  },
  {
    id: "confirmc-auth-http401",
    description:
      "HTTP 401 remains direct authentication evidence even with minimal body semantics.",
    title: "Authorization",
    body: `<main><h1>Authorization needed</h1></main>`,
    httpStatus: 401,
    expectedPrimaryState: "authentication_required",
    expectedPropositions: propositions({
      authenticationRequired: true,
      interstitialPresented: true,
    }),
    criticality: "standard",
    tags: ["confirmatory-c", "authentication", "http-401"],
  },
  {
    id: "confirmc-ready-password-change-settings",
    description:
      "A password-change settings form with new-password semantics is not an authentication wall.",
    title: "Change password",
    body: `
      <main>
        <h1>Account settings</h1>
        <label>Current password <input type="password" autocomplete="current-password" /></label>
        <label>New password <input type="password" autocomplete="new-password" /></label>
        <button>Update password</button>
      </main>`,
    expectedPrimaryState: "ready",
    expectedPropositions: propositions({
      primaryContentAvailable: true,
    }),
    criticality: "critical",
    tags: [
      "confirmatory-c",
      "ready",
      "authentication-negative",
      "new-password",
    ],
  },
  {
    id: "confirmc-restriction-blocked-requests-alert",
    description:
      "A workflow-wide blocking alert expresses restriction without relying on the earlier exact wording.",
    title: "Requests blocked",
    body: `
      <main role="alert">
        <h1>Requests from this workspace are blocked</h1>
        <p>This resource cannot be served until the workspace restriction is removed.</p>
      </main>`,
    expectedPrimaryState: "access_restricted",
    expectedPropositions: propositions({
      accessRestricted: true,
      interstitialPresented: true,
    }),
    criticality: "critical",
    tags: ["confirmatory-c", "access-restricted", "alert"],
  },
  {
    id: "confirmc-error-dashboard-unavailable-alert",
    description:
      "A terminal application failure can refer to a dashboard rather than page/view/application.",
    title: "Dashboard unavailable",
    body: `
      <main role="alert">
        <h1>Dashboard unavailable</h1>
        <p>The dashboard cannot be displayed right now. Reload to try again.</p>
      </main>`,
    expectedPrimaryState: "error",
    expectedPropositions: propositions({
      errorPresented: true,
      interstitialPresented: true,
    }),
    criticality: "critical",
    tags: ["confirmatory-c", "error", "semantic-variant"],
  },
  {
    id: "confirmc-unknown-cookie-consent-modal",
    description:
      "A blocking consent modal is a real intervening surface but does not imply a known blocker category.",
    title: "News",
    body: `
      <main><h1>News</h1></main>
      <div role="dialog" aria-modal="true" style="position:fixed;inset:0;background:white">
        <h2>Cookie preferences</h2>
        <p>Choose your preferences before continuing.</p>
        <button>Accept</button><button>Manage</button>
      </div>`,
    expectedPrimaryState: "unknown_interstitial",
    expectedPropositions: propositions({
      interstitialPresented: true,
    }),
    criticality: "standard",
    tags: ["confirmatory-c", "unknown-interstitial", "consent"],
  },
  {
    id: "confirmc-overlap-passkey-verification",
    description:
      "Verification and passkey authentication overlap; verification is primary while authentication remains true.",
    title: "Secure continuation",
    body: `
      <main>
        <h1>Verify you are human to continue</h1>
        <p>After verification, use the passkey registered to this account.</p>
        <button>Use passkey</button>
      </main>`,
    expectedPrimaryState: "human_verification",
    expectedPropositions: propositions({
      authenticationRequired: true,
      humanVerificationPresented: true,
      interstitialPresented: true,
    }),
    criticality: "standard",
    tags: ["confirmatory-c", "overlap", "authentication", "human-verification"],
  },
  {
    id: "confirmc-overlap-restriction-error",
    description:
      "Throttling and a terminal view error overlap; restriction remains primary by frozen precedence.",
    title: "Unavailable",
    body: `
      <main role="alert">
        <h1>Unable to display the requested view</h1>
        <p>Requests are temporarily limited.</p>
      </main>`,
    httpStatus: 429,
    expectedPrimaryState: "access_restricted",
    expectedPropositions: propositions({
      accessRestricted: true,
      errorPresented: true,
      interstitialPresented: true,
    }),
    criticality: "standard",
    tags: ["confirmatory-c", "overlap", "access-restricted", "error"],
  },
];
