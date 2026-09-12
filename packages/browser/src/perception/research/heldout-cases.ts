import type { PageStateKind, PageStateRecommendedAction } from "@rove/protocol";

import type {
  BenchmarkCriticality,
  PropositionSet,
} from "../benchmark/types.js";

export interface Gate6HeldoutDefinition {
  id: string;
  description: string;
  title: string;
  body: string;
  expectedPrimaryState: PageStateKind;
  expectedPropositions: PropositionSet;
  criticality: BenchmarkCriticality;
  tags: string[];
  httpStatus?: number;
  notes?: string;
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

export function gate6Disposition(
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

export function gate6Document(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${title}</title>
  </head>
  <body>${body}</body>
</html>`;
}

const VISIBLE_CHALLENGE_FRAME = `
<iframe
  title="Human verification"
  style="width:320px;height:140px;border:1px solid black"
  srcdoc="<!doctype html><html><body><main><h1>Human check required</h1><button>Continue</button></main></body></html>"
></iframe>`;

export const GATE6_HELDOUT_CASES: Gate6HeldoutDefinition[] = [
  {
    id: "heldout-ready-quoted-verification-doc",
    description:
      "Ordinary documentation quotes exact verification wording without presenting a challenge.",
    title: "Integration guide",
    body: `
      <main>
        <h1>Integration guide</h1>
        <p>
          A support article may display the sentence
          <q>Verify you are human to continue.</q>
          when explaining verification flows.
        </p>
        <button>Next section</button>
      </main>`,
    expectedPrimaryState: "ready",
    expectedPropositions: propositions({
      primaryContentAvailable: true,
    }),
    criticality: "critical",
    tags: ["held-out", "ready", "quoted-copy", "verification-negative"],
  },
  {
    id: "heldout-ready-painted-canvas-app",
    description:
      "A legitimate full-size painted canvas application is intended content, not an interstitial.",
    title: "Canvas workspace",
    body: `
      <canvas id="workspace" width="640" height="240" aria-label="Game board"></canvas>
      <script>
        const canvas = document.querySelector("#workspace");
        const context = canvas.getContext("2d");
        context.fillStyle = "#17324d";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.fillStyle = "#ffffff";
        context.font = "24px sans-serif";
        context.fillText("Game board", 40, 120);
      </script>`,
    expectedPrimaryState: "ready",
    expectedPropositions: propositions({
      primaryContentAvailable: true,
    }),
    criticality: "critical",
    tags: ["held-out", "ready", "canvas", "visual-control"],
  },
  {
    id: "heldout-auth-form-title-variant",
    description:
      "A credential wall uses common authentication structure without the frozen exact phrase.",
    title: "Welcome back",
    body: `
      <main>
        <h1>Access your workspace</h1>
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
    tags: ["held-out", "authentication", "semantic-variant"],
  },
  {
    id: "heldout-auth-account-chooser",
    description:
      "An account-selection wall requires authentication continuation without a credential form.",
    title: "Choose account",
    body: `
      <main role="main">
        <h1>Continue with an account</h1>
        <button>Personal account</button>
        <button>Work account</button>
      </main>`,
    expectedPrimaryState: "authentication_required",
    expectedPropositions: propositions({
      authenticationRequired: true,
      interstitialPresented: true,
    }),
    criticality: "critical",
    tags: ["held-out", "authentication", "account-chooser"],
  },
  {
    id: "heldout-restriction-paraphrase",
    description:
      "A stable access-denial wall expresses restriction semantics with held-out wording.",
    title: "Request limited",
    body: `
      <main role="alert">
        <h1>We've temporarily limited your access</h1>
        <p>Requests from this connection cannot continue right now. Try again later.</p>
      </main>`,
    expectedPrimaryState: "access_restricted",
    expectedPropositions: propositions({
      accessRestricted: true,
      interstitialPresented: true,
    }),
    criticality: "critical",
    tags: ["held-out", "access-restricted", "semantic-variant"],
  },
  {
    id: "heldout-error-paraphrase-200",
    description:
      "An application-level terminal failure is presented even though the document response is 200.",
    title: "Application problem",
    body: `
      <main role="alert">
        <h1>Something went wrong</h1>
        <p>The application could not load. Reload this page to continue.</p>
      </main>`,
    expectedPrimaryState: "error",
    expectedPropositions: propositions({
      errorPresented: true,
      interstitialPresented: true,
    }),
    criticality: "critical",
    tags: ["held-out", "error", "semantic-variant", "http-200"],
    httpStatus: 200,
  },
  {
    id: "heldout-verification-frame-title-only",
    description:
      "A materially presented verification iframe is named accessibly while top-frame body text does not repeat its challenge copy.",
    title: "Security step",
    body: VISIBLE_CHALLENGE_FRAME,
    expectedPrimaryState: "human_verification",
    expectedPropositions: propositions({
      humanVerificationPresented: true,
      interstitialPresented: true,
    }),
    criticality: "critical",
    tags: ["held-out", "human-verification", "frame", "accessibility"],
  },
  {
    id: "heldout-verification-paraphrase-frame",
    description:
      "A presented challenge uses held-out human-check wording plus a visible verification frame.",
    title: "Security step",
    body: `
      <main>
        <h1>Human check required</h1>
        <p>Complete the verification step below before proceeding.</p>
        ${VISIBLE_CHALLENGE_FRAME}
      </main>`,
    expectedPrimaryState: "human_verification",
    expectedPropositions: propositions({
      humanVerificationPresented: true,
      interstitialPresented: true,
    }),
    criticality: "critical",
    tags: ["held-out", "human-verification", "semantic-variant", "frame"],
  },
  {
    id: "heldout-overlap-restriction-verification",
    description:
      "A throttled response also presents a held-out human-verification interaction; verification is the immediate blocker.",
    title: "Additional check",
    body: `
      <main>
        <h1>Requests from this network are temporarily limited</h1>
        <p>A human check is required before access can resume.</p>
        ${VISIBLE_CHALLENGE_FRAME}
      </main>`,
    expectedPrimaryState: "human_verification",
    expectedPropositions: propositions({
      humanVerificationPresented: true,
      accessRestricted: true,
      interstitialPresented: true,
    }),
    criticality: "standard",
    tags: ["held-out", "overlap", "human-verification", "access-restricted"],
    httpStatus: 429,
  },
  {
    id: "heldout-unknown-dialog-labelledby",
    description:
      "A stable modal intervening surface uses aria-labelledby and has no known auth, verification, restriction, or error semantics.",
    title: "Continue",
    body: `
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="gate-title"
        style="position:fixed;inset:0;background:white;z-index:20"
      >
        <h1 id="gate-title">Continue to destination</h1>
        <p>This intermediate step must be reviewed before the requested page is shown.</p>
        <button>Review</button>
      </div>`,
    expectedPrimaryState: "unknown_interstitial",
    expectedPropositions: propositions({
      interstitialPresented: true,
    }),
    criticality: "critical",
    tags: ["held-out", "unknown-interstitial", "aria-labelledby", "dialog"],
  },
  {
    id: "heldout-ready-visible-ordinary-iframe",
    description:
      "An ordinary visible iframe is application content and must not become verification merely because a frame is presented.",
    title: "Analytics dashboard",
    body: `
      <main>
        <h1>Analytics dashboard</h1>
        <p>Current workspace metrics.</p>
        <iframe
          title="Analytics chart"
          style="width:500px;height:220px"
          srcdoc="<!doctype html><html><body><h2>Quarterly chart</h2></body></html>"
        ></iframe>
      </main>`,
    expectedPrimaryState: "ready",
    expectedPropositions: propositions({
      primaryContentAvailable: true,
    }),
    criticality: "critical",
    tags: ["held-out", "ready", "iframe", "presentation-negative"],
  },
  {
    id: "heldout-ready-hidden-accessible-challenge",
    description:
      "Hidden challenge-labelled markup must not be treated as a presented blocker.",
    title: "Article",
    body: `
      <main>
        <h1>Article</h1>
        <p>Normal application content.</p>
        <button>Continue reading</button>
      </main>
      <div style="display:none" aria-label="Verification challenge">
        Verify you are human to continue.
      </div>`,
    expectedPrimaryState: "ready",
    expectedPropositions: propositions({
      primaryContentAvailable: true,
    }),
    criticality: "critical",
    tags: ["held-out", "ready", "hidden", "accessibility-negative"],
  },
];
