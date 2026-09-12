import type { PageStateKind, PageStateRecommendedAction } from "@rove/protocol";

import type {
  BenchmarkCriticality,
  PropositionSet,
} from "../benchmark/types.js";

export interface Gate6ChallengeBDefinition {
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

export function challengeBDisposition(
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

const robotFrame = `
<iframe
  title="Robot check"
  style="width:340px;height:150px;border:1px solid #777"
  srcdoc="<!doctype html><html><body><main><label><input type='checkbox'> I am not a robot</label><button>Proceed</button></main></body></html>"
></iframe>`;

export const GATE6_CHALLENGE_B_CASES: Gate6ChallengeBDefinition[] = [
  {
    id: "confirm-ready-security-challenge-tutorial-heading",
    description:
      "A tutorial heading uses directive-like security-challenge wording but is ordinary content.",
    title: "Developer guide",
    body: `
      <main>
        <h1>How to complete a security challenge integration</h1>
        <p>This guide explains test fixtures, callbacks, and retry behavior.</p>
        <a href="#next">Next chapter</a>
      </main>`,
    expectedPrimaryState: "ready",
    expectedPropositions: propositions({
      primaryContentAvailable: true,
    }),
    criticality: "critical",
    tags: ["confirmatory", "ready", "context-negative", "verification"],
  },
  {
    id: "confirm-ready-error-troubleshooting-heading",
    description:
      "Documentation discusses a common error phrase in its heading without presenting an application failure.",
    title: "Troubleshooting guide",
    body: `
      <main>
        <h1>Understanding “Something went wrong” messages</h1>
        <p>This article explains how applications should report failures to operators.</p>
        <button>Open example</button>
      </main>`,
    expectedPrimaryState: "ready",
    expectedPropositions: propositions({
      primaryContentAvailable: true,
    }),
    criticality: "critical",
    tags: ["confirmatory", "ready", "context-negative", "error"],
  },
  {
    id: "confirm-ready-small-nonblocking-dialog",
    description:
      "A small non-modal dialog-like popover is application UI, not a blocking interstitial.",
    title: "Editor",
    body: `
      <main>
        <h1>Document editor</h1>
        <textarea>Draft content</textarea>
      </main>
      <div
        role="dialog"
        style="position:fixed;right:20px;bottom:20px;width:280px;height:100px;background:white;border:1px solid black"
      >
        <p>Formatting tips</p>
        <button>Dismiss</button>
      </div>`,
    expectedPrimaryState: "ready",
    expectedPropositions: propositions({
      primaryContentAvailable: true,
    }),
    criticality: "critical",
    tags: ["confirmatory", "ready", "dialog", "nonblocking"],
  },
  {
    id: "confirm-ready-labelled-canvas-app",
    description:
      "A legitimate visible canvas with a normal application label remains primary content.",
    title: "Whiteboard",
    body: `
      <canvas
        id="board"
        width="700"
        height="280"
        aria-label="Collaborative whiteboard"
      ></canvas>
      <script>
        const canvas = document.querySelector("#board");
        const context = canvas.getContext("2d");
        context.fillStyle = "#eee";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.fillStyle = "#222";
        context.font = "28px sans-serif";
        context.fillText("Sprint sketch", 50, 140);
      </script>`,
    expectedPrimaryState: "ready",
    expectedPropositions: propositions({
      primaryContentAvailable: true,
    }),
    criticality: "critical",
    tags: ["confirmatory", "ready", "canvas", "visual-control"],
  },
  {
    id: "confirm-verification-robot-modal",
    description:
      "A blocking human-verification interaction uses robot language rather than the earlier verification vocabulary.",
    title: "Please wait",
    body: `
      <div
        role="dialog"
        aria-modal="true"
        style="position:fixed;inset:0;background:white"
      >
        <h1>Prove you’re not a robot</h1>
        <p>Check the box below before moving on.</p>
        <label><input type="checkbox" /> I’m not a robot</label>
        <button>Proceed</button>
      </div>`,
    expectedPrimaryState: "human_verification",
    expectedPropositions: propositions({
      humanVerificationPresented: true,
      interstitialPresented: true,
    }),
    criticality: "critical",
    tags: ["confirmatory", "human-verification", "robot", "modal"],
  },
  {
    id: "confirm-verification-robot-frame-only",
    description:
      "A materially presented robot-check iframe carries the verification semantics without matching earlier frame vocabulary.",
    title: "Additional step",
    body: robotFrame,
    expectedPrimaryState: "human_verification",
    expectedPropositions: propositions({
      humanVerificationPresented: true,
      interstitialPresented: true,
    }),
    criticality: "critical",
    tags: ["confirmatory", "human-verification", "robot", "frame"],
  },
  {
    id: "confirm-auth-unlock-session-form",
    description:
      "A credential wall requires authentication but uses unlock/session language rather than sign-in wording.",
    title: "Session locked",
    body: `
      <main>
        <h1>Unlock your session</h1>
        <p>Enter your account credentials to regain access.</p>
        <label>Username <input autocomplete="username" /></label>
        <label>Secret <input type="password" /></label>
        <button>Unlock</button>
      </main>`,
    expectedPrimaryState: "authentication_required",
    expectedPropositions: propositions({
      authenticationRequired: true,
      interstitialPresented: true,
    }),
    criticality: "critical",
    tags: ["confirmatory", "authentication", "credential-form"],
  },
  {
    id: "confirm-auth-select-identity",
    description:
      "A full-page identity chooser requires account continuation without using account/sign-in wording.",
    title: "Identity",
    body: `
      <main>
        <h1>Select an identity to continue</h1>
        <button>alice@example.test</button>
        <button>work@example.test</button>
      </main>`,
    expectedPrimaryState: "authentication_required",
    expectedPropositions: propositions({
      authenticationRequired: true,
      interstitialPresented: true,
    }),
    criticality: "critical",
    tags: ["confirmatory", "authentication", "identity-chooser"],
  },
  {
    id: "confirm-restriction-http-451",
    description: "HTTP 451 directly establishes a legal access restriction.",
    title: "Unavailable",
    body: `
      <main role="alert">
        <h1>Unavailable for legal reasons</h1>
        <p>This resource cannot be served in your region.</p>
      </main>`,
    httpStatus: 451,
    expectedPrimaryState: "access_restricted",
    expectedPropositions: propositions({
      accessRestricted: true,
      interstitialPresented: true,
    }),
    criticality: "critical",
    tags: ["confirmatory", "access-restricted", "http-451"],
  },
  {
    id: "confirm-restriction-network-suspended",
    description:
      "A stable network suspension wall expresses restriction semantics with unseen wording.",
    title: "Connection suspended",
    body: `
      <main role="alert">
        <h1>This network has been suspended temporarily</h1>
        <p>Requests from this address cannot be served at the moment.</p>
      </main>`,
    expectedPrimaryState: "access_restricted",
    expectedPropositions: propositions({
      accessRestricted: true,
      interstitialPresented: true,
    }),
    criticality: "critical",
    tags: ["confirmatory", "access-restricted", "semantic-variant"],
  },
  {
    id: "confirm-error-http-404-not-found",
    description:
      "A terminal missing-resource page is an error even though it is not a 5xx response.",
    title: "Not found",
    body: `
      <main role="alert">
        <h1>Page not found</h1>
        <p>The requested resource does not exist.</p>
      </main>`,
    httpStatus: 404,
    expectedPrimaryState: "error",
    expectedPropositions: propositions({
      errorPresented: true,
      interstitialPresented: true,
    }),
    criticality: "critical",
    tags: ["confirmatory", "error", "http-404"],
  },
  {
    id: "confirm-error-hit-a-snag",
    description:
      "An application-level terminal failure uses unseen failure wording on HTTP 200.",
    title: "Problem",
    body: `
      <main role="alert">
        <h1>We hit a snag</h1>
        <p>This view can’t be displayed right now. Reload to try again.</p>
      </main>`,
    httpStatus: 200,
    expectedPrimaryState: "error",
    expectedPropositions: propositions({
      errorPresented: true,
      interstitialPresented: true,
    }),
    criticality: "critical",
    tags: ["confirmatory", "error", "semantic-variant"],
  },
  {
    id: "confirm-unknown-large-dialog",
    description:
      "A large non-modal-marked dialog occupies most of the viewport and blocks the requested experience.",
    title: "Notice",
    body: `
      <main><h1>Destination content</h1></main>
      <div
        role="dialog"
        style="position:fixed;left:5vw;top:5vh;width:90vw;height:85vh;background:white;z-index:30"
      >
        <h2>Before you continue</h2>
        <p>This notice must be reviewed before the requested destination is usable.</p>
        <button>Review</button>
      </div>`,
    expectedPrimaryState: "unknown_interstitial",
    expectedPropositions: propositions({
      interstitialPresented: true,
    }),
    criticality: "critical",
    tags: ["confirmatory", "unknown-interstitial", "dialog"],
  },
  {
    id: "confirm-overlap-error-robot-verification",
    description:
      "An HTTP 503 response also presents a robot-check interaction; verification remains the immediate blocker.",
    title: "Additional check",
    body: `
      <div role="dialog" aria-modal="true" style="position:fixed;inset:0;background:white">
        <h1>Prove you’re not a robot</h1>
        <label><input type="checkbox" /> I’m not a robot</label>
        <button>Proceed</button>
      </div>`,
    httpStatus: 503,
    expectedPrimaryState: "human_verification",
    expectedPropositions: propositions({
      humanVerificationPresented: true,
      errorPresented: true,
      interstitialPresented: true,
    }),
    criticality: "standard",
    tags: ["confirmatory", "overlap", "human-verification", "error"],
  },
  {
    id: "confirm-overlap-auth-restriction",
    description:
      "A throttled response also presents a credential unlock wall; authentication outranks restriction.",
    title: "Session locked",
    body: `
      <main>
        <h1>Unlock your session</h1>
        <label>Username <input autocomplete="username" /></label>
        <label>Password <input type="password" /></label>
        <button>Unlock</button>
      </main>`,
    httpStatus: 429,
    expectedPrimaryState: "authentication_required",
    expectedPropositions: propositions({
      authenticationRequired: true,
      accessRestricted: true,
      interstitialPresented: true,
    }),
    criticality: "standard",
    tags: ["confirmatory", "overlap", "authentication", "access-restricted"],
  },
  {
    id: "confirm-control-http-502",
    description:
      "A conventional 5xx terminal failure remains a positive error control.",
    title: "Bad gateway",
    body: `<main role="alert"><h1>Bad gateway</h1></main>`,
    httpStatus: 502,
    expectedPrimaryState: "error",
    expectedPropositions: propositions({
      errorPresented: true,
      interstitialPresented: true,
    }),
    criticality: "standard",
    tags: ["confirmatory", "error", "positive-control"],
  },
];
