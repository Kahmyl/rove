import type { PageStateKind, PageStateRecommendedAction } from "@rove/protocol";

import type { PageSignals } from "../../safety/page-state-classifier.js";
import type { BenchmarkCase, PropositionSet } from "../benchmark/types.js";

export const LOCAL_PERCEPTION_CORPUS_VERSION = 1;

export interface LocalPerceptionCase extends BenchmarkCase<PageSignals> {
  tier: "A";
  route?: string;
  pipelineEligible: boolean;
}

export interface PerceptionFixture {
  body: string;
  status: number;
}

export interface TemporalPerceptionScenario {
  id: string;
  tier: "A";
  description: string;
  route: string;
  tags: string[];
  checkpoints: Array<{
    afterMs: number;
    expectedPrimaryState: PageStateKind;
  }>;
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

function disposition(state: PageStateKind): PageStateRecommendedAction {
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

function documentHtml(title: string, body: string, extraHead = ""): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${title}</title>
    ${extraHead}
  </head>
  <body>
    ${body}
  </body>
</html>`;
}

const RICH_JOB_TEXT =
  `${"Role responsibilities and qualifications. ".repeat(20)}` +
  "Familiarity with proxy management, CAPTCHA handling, and IP rotation strategies.";

const RICH_PAGE_TEXT =
  `${"Public job listing content with filters and role summaries. ".repeat(16)}` +
  "Browse available opportunities.";

const FRAME_URL = "https://fixture.invalid/perception/frame/recaptcha";

const frame = (style = "") =>
  `<iframe title="Passive provider frame" style="${style}" src="/perception/frame/recaptcha"></iframe>`;

const UNKNOWN_VISUAL_INTERSTITIAL_HTML = documentHtml(
  "Challenge",
  `<canvas
    id="unknown-visual-surface"
    width="640"
    height="240"
    aria-label="Intervening visual page"
  ></canvas>
  <script>
    const canvas = document.querySelector("#unknown-visual-surface");
    const context = canvas.getContext("2d");
    context.fillStyle = "#111";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#fff";
    context.font = "24px sans-serif";
    context.fillText("Continue in this browser window", 40, 120);
  </script>`,
);

interface CaseDefinition {
  id: string;
  description: string;
  expectedPrimaryState: PageStateKind;
  expectedPropositions: PropositionSet;
  criticality: LocalPerceptionCase["criticality"];
  tags: string[];
  signals: PageSignals;
  fixture?: PerceptionFixture;
  pipelineEligible?: boolean;
  notes?: string;
}

function localCase(definition: CaseDefinition): LocalPerceptionCase {
  const route =
    definition.fixture === undefined
      ? undefined
      : `/perception/${definition.id}`;

  return {
    id: definition.id,
    tier: "A",
    description: definition.description,
    input: definition.signals,
    expectedPropositions: definition.expectedPropositions,
    expectedPrimaryState: definition.expectedPrimaryState,
    expectedDisposition: disposition(definition.expectedPrimaryState),
    criticality: definition.criticality,
    tags: definition.tags,
    ...(definition.notes === undefined ? {} : { notes: definition.notes }),
    ...(route === undefined ? {} : { route }),
    pipelineEligible: definition.pipelineEligible ?? route !== undefined,
  };
}

const DEFINITIONS: CaseDefinition[] = [
  {
    id: "ready-normal",
    description: "Stable ordinary page with visible content and controls.",
    expectedPrimaryState: "ready",
    expectedPropositions: propositions({
      primaryContentAvailable: true,
    }),
    criticality: "critical",
    tags: ["ready", "control"],
    signals: {
      url: "https://fixture.invalid/perception/ready-normal",
      title: "Normal page",
      text: "Normal public content Continue",
      rawHtml: documentHtml(
        "Normal page",
        "<main><h1>Normal public content</h1><button>Continue</button></main>",
      ),
      readyState: "complete",
      targetCount: 1,
    },
    fixture: {
      body: documentHtml(
        "Normal page",
        "<main><h1>Normal public content</h1><button>Continue</button></main>",
      ),
      status: 200,
    },
  },
  {
    id: "ready-blank",
    description:
      "Stable intentionally blank document with no established blocker.",
    expectedPrimaryState: "ready",
    expectedPropositions: propositions({}),
    criticality: "critical",
    tags: ["ready", "blank"],
    signals: {
      url: "https://fixture.invalid/perception/ready-blank",
      title: "Blank",
      text: "",
      rawHtml:
        "<!doctype html><html><head><title>Blank</title></head><body></body></html>",
      readyState: "complete",
      targetCount: 0,
    },
    fixture: {
      body: "<!doctype html><html><head><title>Blank</title></head><body></body></html>",
      status: 200,
    },
  },
  {
    id: "ready-security-copy",
    description:
      "Ordinary security terminology that is not a verification challenge.",
    expectedPrimaryState: "ready",
    expectedPropositions: propositions({
      primaryContentAvailable: true,
    }),
    criticality: "critical",
    tags: ["ready", "adversarial-copy"],
    signals: {
      url: "https://fixture.invalid/perception/ready-security-copy",
      title: "Security settings",
      text: "Manage team access and security settings.",
      rawHtml: documentHtml(
        "Security settings",
        "<main><h1>Security settings</h1><p>Manage team access and security settings.</p></main>",
      ),
      readyState: "complete",
      targetCount: 0,
    },
    fixture: {
      body: documentHtml(
        "Security settings",
        "<main><h1>Security settings</h1><p>Manage team access and security settings.</p></main>",
      ),
      status: 200,
    },
  },
  {
    id: "ready-captcha-expertise-rich",
    description:
      "Content-rich job description discusses CAPTCHA technology without presenting a challenge.",
    expectedPrimaryState: "ready",
    expectedPropositions: propositions({
      primaryContentAvailable: true,
    }),
    criticality: "critical",
    tags: ["ready", "adversarial-copy", "captcha-term"],
    signals: {
      url: "https://fixture.invalid/perception/ready-captcha-expertise-rich",
      title: "Python Developer",
      text: RICH_JOB_TEXT,
      rawHtml: documentHtml(
        "Python Developer",
        `<main><article>${RICH_JOB_TEXT}</article></main>`,
      ),
      readyState: "complete",
      targetCount: 5,
    },
    fixture: {
      body: documentHtml(
        "Python Developer",
        `<main><article>${RICH_JOB_TEXT}</article></main>`,
      ),
      status: 200,
    },
  },
  {
    id: "ready-passive-recaptcha-rich",
    description:
      "Content-rich page contains a passive provider frame but no presented verification blocker.",
    expectedPrimaryState: "ready",
    expectedPropositions: propositions({
      primaryContentAvailable: true,
    }),
    criticality: "critical",
    tags: ["ready", "passive-provider", "recaptcha", "rich-dom"],
    signals: {
      url: "https://fixture.invalid/perception/ready-passive-recaptcha-rich",
      title: "Job listings",
      text: RICH_PAGE_TEXT,
      rawHtml: documentHtml(
        "Job listings",
        `<main><p>${RICH_PAGE_TEXT}</p><button>Search</button>${frame()}</main>`,
      ),
      readyState: "complete",
      frameUrls: [FRAME_URL],
      targetCount: 20,
    },
    fixture: {
      body: documentHtml(
        "Job listings",
        `<main><p>${RICH_PAGE_TEXT}</p><button>Search</button>${frame()}</main>`,
      ),
      status: 200,
    },
  },
  {
    id: "ready-hidden-recaptcha-empty",
    description:
      "Hidden provider frame on an otherwise blank stable page is not a presented challenge.",
    expectedPrimaryState: "ready",
    expectedPropositions: propositions({}),
    criticality: "critical",
    tags: [
      "ready",
      "passive-provider",
      "recaptcha",
      "visibility",
      "display-none",
    ],
    signals: {
      url: "https://fixture.invalid/perception/ready-hidden-recaptcha-empty",
      title: "Blank shell",
      text: "",
      rawHtml: documentHtml("Blank shell", frame("display:none")),
      readyState: "complete",
      frameUrls: [FRAME_URL],
      targetCount: 0,
    },
    fixture: {
      body: documentHtml("Blank shell", frame("display:none")),
      status: 200,
    },
  },
  {
    id: "ready-opacity-zero-recaptcha-empty",
    description:
      "Fully transparent provider frame is not a presented challenge.",
    expectedPrimaryState: "ready",
    expectedPropositions: propositions({}),
    criticality: "critical",
    tags: [
      "ready",
      "passive-provider",
      "recaptcha",
      "visibility",
      "opacity-zero",
    ],
    signals: {
      url: "https://fixture.invalid/perception/ready-opacity-zero-recaptcha-empty",
      title: "Transparent shell",
      text: "",
      rawHtml: documentHtml(
        "Transparent shell",
        frame("opacity:0;width:300px;height:100px"),
      ),
      readyState: "complete",
      frameUrls: [FRAME_URL],
      targetCount: 0,
    },
    fixture: {
      body: documentHtml(
        "Transparent shell",
        frame("opacity:0;width:300px;height:100px"),
      ),
      status: 200,
    },
  },
  {
    id: "ready-offscreen-recaptcha-empty",
    description: "Offscreen provider frame is not a presented challenge.",
    expectedPrimaryState: "ready",
    expectedPropositions: propositions({}),
    criticality: "critical",
    tags: ["ready", "passive-provider", "recaptcha", "visibility", "offscreen"],
    signals: {
      url: "https://fixture.invalid/perception/ready-offscreen-recaptcha-empty",
      title: "Offscreen shell",
      text: "",
      rawHtml: documentHtml(
        "Offscreen shell",
        frame(
          "position:absolute;left:-10000px;top:-10000px;width:300px;height:100px",
        ),
      ),
      readyState: "complete",
      frameUrls: [FRAME_URL],
      targetCount: 0,
    },
    fixture: {
      body: documentHtml(
        "Offscreen shell",
        frame(
          "position:absolute;left:-10000px;top:-10000px;width:300px;height:100px",
        ),
      ),
      status: 200,
    },
  },
  {
    id: "ready-one-pixel-recaptcha-empty",
    description: "Effectively 1x1 provider frame is not a presented challenge.",
    expectedPrimaryState: "ready",
    expectedPropositions: propositions({}),
    criticality: "critical",
    tags: ["ready", "passive-provider", "recaptcha", "visibility", "one-pixel"],
    signals: {
      url: "https://fixture.invalid/perception/ready-one-pixel-recaptcha-empty",
      title: "Tiny shell",
      text: "",
      rawHtml: documentHtml(
        "Tiny shell",
        frame("width:1px;height:1px;border:0"),
      ),
      readyState: "complete",
      frameUrls: [FRAME_URL],
      targetCount: 0,
    },
    fixture: {
      body: documentHtml("Tiny shell", frame("width:1px;height:1px;border:0")),
      status: 200,
    },
  },
  {
    id: "ready-clipped-recaptcha-empty",
    description:
      "Provider frame fully clipped by its container is not a presented challenge.",
    expectedPrimaryState: "ready",
    expectedPropositions: propositions({}),
    criticality: "critical",
    tags: ["ready", "passive-provider", "recaptcha", "visibility", "clipped"],
    signals: {
      url: "https://fixture.invalid/perception/ready-clipped-recaptcha-empty",
      title: "Clipped shell",
      text: "",
      rawHtml: documentHtml(
        "Clipped shell",
        `<div style="width:0;height:0;overflow:hidden">${frame("width:300px;height:100px")}</div>`,
      ),
      readyState: "complete",
      frameUrls: [FRAME_URL],
      targetCount: 0,
    },
    fixture: {
      body: documentHtml(
        "Clipped shell",
        `<div style="width:0;height:0;overflow:hidden">${frame("width:300px;height:100px")}</div>`,
      ),
      status: 200,
    },
  },
  {
    id: "ready-provider-behind-modal",
    description:
      "Provider frame behind the current visible surface is not the immediate blocker.",
    expectedPrimaryState: "ready",
    expectedPropositions: propositions({
      primaryContentAvailable: true,
    }),
    criticality: "critical",
    tags: ["ready", "passive-provider", "recaptcha", "visibility", "occluded"],
    signals: {
      url: "https://fixture.invalid/perception/ready-provider-behind-modal",
      title: "Article",
      text: "Article content Continue reading",
      rawHtml: documentHtml(
        "Article",
        `${frame("position:absolute;inset:0;z-index:1")}
<div style="position:fixed;inset:0;z-index:10;background:white">
  <main><h1>Article content</h1><button>Continue reading</button></main>
</div>`,
      ),
      readyState: "complete",
      frameUrls: [FRAME_URL],
      targetCount: 1,
    },
    fixture: {
      body: documentHtml(
        "Article",
        `${frame("position:absolute;inset:0;z-index:1")}
<div style="position:fixed;inset:0;z-index:10;background:white">
  <main><h1>Article content</h1><button>Continue reading</button></main>
</div>`,
      ),
      status: 200,
    },
  },
  {
    id: "human-verification-visible",
    description:
      "Explicit visible human-verification instruction with a presented provider frame.",
    expectedPrimaryState: "human_verification",
    expectedPropositions: propositions({
      humanVerificationPresented: true,
      interstitialPresented: true,
    }),
    criticality: "critical",
    tags: ["human-verification", "recaptcha", "visible"],
    signals: {
      url: "https://fixture.invalid/perception/human-verification-visible",
      title: "Security check",
      text: "Verify you are human to continue.",
      rawHtml: documentHtml(
        "Security check",
        `<main><h1>Verify you are human to continue.</h1>${frame("width:300px;height:100px")}</main>`,
      ),
      readyState: "complete",
      frameUrls: [FRAME_URL],
      targetCount: 0,
    },
    fixture: {
      body: documentHtml(
        "Security check",
        `<main><h1>Verify you are human to continue.</h1>${frame("width:300px;height:100px")}</main>`,
      ),
      status: 200,
    },
  },
  {
    id: "human-verification-rich-explicit",
    description: "Content-rich page presents an explicit verification blocker.",
    expectedPrimaryState: "human_verification",
    expectedPropositions: propositions({
      primaryContentAvailable: true,
      humanVerificationPresented: true,
      interstitialPresented: true,
    }),
    criticality: "critical",
    tags: ["human-verification", "visible", "rich-dom"],
    signals: {
      url: "https://fixture.invalid/perception/human-verification-rich-explicit",
      title: "Account",
      text:
        `${"Account information and settings. ".repeat(20)}` +
        "Complete the CAPTCHA to continue.",
      rawHtml: documentHtml(
        "Account",
        `<main><p>${"Account information and settings. ".repeat(20)}</p><h2>Complete the CAPTCHA to continue.</h2></main>`,
      ),
      readyState: "complete",
      targetCount: 20,
    },
    fixture: {
      body: documentHtml(
        "Account",
        `<main><p>${"Account information and settings. ".repeat(20)}</p><h2>Complete the CAPTCHA to continue.</h2></main>`,
      ),
      status: 200,
    },
  },
  {
    id: "authentication-required",
    description: "Stable login wall requires human authentication.",
    expectedPrimaryState: "authentication_required",
    expectedPropositions: propositions({
      authenticationRequired: true,
      interstitialPresented: true,
    }),
    criticality: "critical",
    tags: ["authentication"],
    signals: {
      url: "https://fixture.invalid/perception/authentication-required",
      title: "Sign in",
      text: "Sign in to continue Email",
      rawHtml: documentHtml(
        "Sign in",
        '<main><h1>Sign in to continue</h1><label>Email <input type="email" /></label></main>',
      ),
      readyState: "complete",
      targetCount: 1,
    },
    fixture: {
      body: documentHtml(
        "Sign in",
        '<main><h1>Sign in to continue</h1><label>Email <input type="email" /></label></main>',
      ),
      status: 200,
    },
  },
  {
    id: "access-restricted-copy",
    description: "Explicit stable site-access restriction.",
    expectedPrimaryState: "access_restricted",
    expectedPropositions: propositions({
      accessRestricted: true,
      interstitialPresented: true,
    }),
    criticality: "critical",
    tags: ["access-restricted", "visible"],
    signals: {
      url: "https://fixture.invalid/perception/access-restricted-copy",
      title: "Access restricted",
      text:
        "Access is temporarily restricted. " +
        "We detected unusual activity from your device or network.",
      rawHtml: documentHtml(
        "Access restricted",
        "<main><h1>Access is temporarily restricted</h1><p>We detected unusual activity from your device or network.</p></main>",
      ),
      readyState: "complete",
      targetCount: 0,
    },
    fixture: {
      body: documentHtml(
        "Access restricted",
        "<main><h1>Access is temporarily restricted</h1><p>We detected unusual activity from your device or network.</p></main>",
      ),
      status: 200,
    },
  },
  {
    id: "access-restricted-429",
    description:
      "HTTP 429 restriction without provider or CAPTCHA terminology.",
    expectedPrimaryState: "access_restricted",
    expectedPropositions: propositions({
      accessRestricted: true,
      interstitialPresented: true,
    }),
    criticality: "critical",
    tags: ["access-restricted", "http-429"],
    signals: {
      url: "https://fixture.invalid/perception/access-restricted-429",
      title: "Try again later",
      text: "Please retry later.",
      rawHtml: documentHtml(
        "Try again later",
        "<main><h1>Please retry later.</h1></main>",
      ),
      readyState: "complete",
      httpStatus: 429,
      targetCount: 0,
    },
    fixture: {
      body: documentHtml(
        "Try again later",
        "<main><h1>Please retry later.</h1></main>",
      ),
      status: 429,
    },
  },
  {
    id: "error-503",
    description: "Stable terminal service error.",
    expectedPrimaryState: "error",
    expectedPropositions: propositions({
      errorPresented: true,
      interstitialPresented: true,
    }),
    criticality: "critical",
    tags: ["error", "http-503"],
    signals: {
      url: "https://fixture.invalid/perception/error-503",
      title: "Service unavailable",
      text: "Service unavailable",
      rawHtml: documentHtml(
        "Service unavailable",
        "<main><h1>Service unavailable</h1></main>",
      ),
      readyState: "complete",
      httpStatus: 503,
      targetCount: 0,
    },
    fixture: {
      body: documentHtml(
        "Service unavailable",
        "<main><h1>Service unavailable</h1></main>",
      ),
      status: 503,
    },
  },
  {
    id: "unknown-canvas-interstitial",
    description:
      "Stable blocking visual interstitial has no established known semantic blocker.",
    expectedPrimaryState: "unknown_interstitial",
    expectedPropositions: propositions({
      interstitialPresented: true,
    }),
    criticality: "standard",
    tags: ["unknown-interstitial", "canvas", "empty-visible-dom"],
    signals: {
      url: "https://fixture.invalid/perception/unknown-canvas-interstitial",
      title: "Challenge",
      text: "",
      rawHtml: UNKNOWN_VISUAL_INTERSTITIAL_HTML,
      readyState: "complete",
      targetCount: 0,
    },
    fixture: {
      body: UNKNOWN_VISUAL_INTERSTITIAL_HTML,
      status: 200,
    },
  },
  {
    id: "overlap-auth-verification",
    description:
      "Authentication requirement and presented verification overlap; verification is the immediate blocker.",
    expectedPrimaryState: "human_verification",
    expectedPropositions: propositions({
      authenticationRequired: true,
      humanVerificationPresented: true,
      interstitialPresented: true,
    }),
    criticality: "standard",
    tags: ["overlap", "authentication", "human-verification"],
    signals: {
      url: "https://fixture.invalid/perception/overlap-auth-verification",
      title: "Sign in",
      text: "Sign in to continue. Verify you are human before submitting the login form.",
      rawHtml: documentHtml(
        "Sign in",
        `<main><h1>Sign in to continue</h1><p>Verify you are human before submitting the login form.</p>${frame("width:300px;height:100px")}</main>`,
      ),
      readyState: "complete",
      frameUrls: [FRAME_URL],
      targetCount: 1,
    },
    fixture: {
      body: documentHtml(
        "Sign in",
        `<main><h1>Sign in to continue</h1><p>Verify you are human before submitting the login form.</p>${frame("width:300px;height:100px")}</main>`,
      ),
      status: 200,
    },
  },
  {
    id: "overlap-restriction-verification",
    description:
      "Access restriction and presented verification overlap; verification is the immediate user-resolvable blocker.",
    expectedPrimaryState: "human_verification",
    expectedPropositions: propositions({
      accessRestricted: true,
      humanVerificationPresented: true,
      interstitialPresented: true,
    }),
    criticality: "standard",
    tags: ["overlap", "access-restricted", "human-verification"],
    signals: {
      url: "https://fixture.invalid/perception/overlap-restriction-verification",
      title: "Security review",
      text: "Access is temporarily restricted. Verify you are human to continue.",
      rawHtml: documentHtml(
        "Security review",
        `<main><h1>Access is temporarily restricted</h1><p>Verify you are human to continue.</p>${frame("width:300px;height:100px")}</main>`,
      ),
      readyState: "complete",
      frameUrls: [FRAME_URL],
      targetCount: 0,
    },
    fixture: {
      body: documentHtml(
        "Security review",
        `<main><h1>Access is temporarily restricted</h1><p>Verify you are human to continue.</p>${frame("width:300px;height:100px")}</main>`,
      ),
      status: 200,
    },
  },
  {
    id: "overlap-restriction-error",
    description:
      "Access-denied semantics and HTTP 5xx error overlap; access restriction remains the primary compatibility state.",
    expectedPrimaryState: "access_restricted",
    expectedPropositions: propositions({
      accessRestricted: true,
      errorPresented: true,
      interstitialPresented: true,
    }),
    criticality: "standard",
    tags: ["overlap", "access-restricted", "error", "http-503"],
    signals: {
      url: "https://fixture.invalid/perception/overlap-restriction-error",
      title: "Access denied",
      text: "Access is temporarily restricted. Service unavailable.",
      rawHtml: documentHtml(
        "Access denied",
        "<main><h1>Access is temporarily restricted</h1><p>Service unavailable.</p></main>",
      ),
      readyState: "complete",
      httpStatus: 503,
      targetCount: 0,
    },
    fixture: {
      body: documentHtml(
        "Access denied",
        "<main><h1>Access is temporarily restricted</h1><p>Service unavailable.</p></main>",
      ),
      status: 503,
    },
  },
  {
    id: "loading-document-signal",
    description:
      "Transient document snapshot is not yet trustworthy for a stable semantic label.",
    expectedPrimaryState: "loading",
    expectedPropositions: propositions({
      documentUnstable: true,
    }),
    criticality: "critical",
    tags: ["loading", "signal-only", "temporal"],
    signals: {
      url: "https://fixture.invalid/perception/loading-document-signal",
      title: "Loading",
      text: "",
      rawHtml: "<html><body>Loading</body></html>",
      readyState: "loading",
      targetCount: 0,
    },
    pipelineEligible: false,
    notes:
      "Signal-only in Gate 2. Browser temporal acquisition is measured after stabilization research.",
  },
];

export const LOCAL_PERCEPTION_CASES: LocalPerceptionCase[] =
  DEFINITIONS.map(localCase);

const TEMPORAL_READY_TO_VERIFICATION = documentHtml(
  "Temporal verification",
  `<main id="content"><h1>Public content</h1><button>Continue</button></main>
<script>
setTimeout(() => {
  const overlay = document.createElement("div");
  overlay.id = "verification-overlay";
  overlay.style.cssText = "position:fixed;inset:0;background:white;z-index:20";
  overlay.innerHTML = '<h1>Verify you are human to continue.</h1><iframe title="Verification" src="/perception/frame/recaptcha"></iframe>';
  document.body.append(overlay);
}, 250);
</script>`,
);

const TEMPORAL_LOADING_TO_READY = documentHtml(
  "Temporal loading",
  `<main id="content" aria-busy="true"><h1>Loading application</h1></main>
<script>
setTimeout(() => {
  const main = document.querySelector("#content");
  main.removeAttribute("aria-busy");
  main.innerHTML = "<h1>Application ready</h1><button>Continue</button>";
}, 250);
</script>`,
);

const TEMPORAL_LOADING_TO_AUTH = documentHtml(
  "Temporal authentication",
  `<main id="content" aria-busy="true"><h1>Loading account</h1></main>
<script>
setTimeout(() => {
  const main = document.querySelector("#content");
  main.removeAttribute("aria-busy");
  main.innerHTML = '<h1>Sign in to continue</h1><label>Email <input type="email"></label>';
  document.title = "Sign in";
}, 250);
</script>`,
);

export const TEMPORAL_PERCEPTION_SCENARIOS: TemporalPerceptionScenario[] = [
  {
    id: "temporal-ready-to-verification",
    tier: "A",
    description:
      "A stable useful page later receives a blocking verification overlay.",
    route: "/perception/temporal-ready-to-verification",
    tags: ["temporal", "human-verification", "overlay"],
    checkpoints: [
      { afterMs: 0, expectedPrimaryState: "ready" },
      { afterMs: 350, expectedPrimaryState: "human_verification" },
    ],
  },
  {
    id: "temporal-loading-to-ready",
    tier: "A",
    description: "A visibly loading application shell becomes normal content.",
    route: "/perception/temporal-loading-to-ready",
    tags: ["temporal", "loading", "ready"],
    checkpoints: [
      { afterMs: 0, expectedPrimaryState: "loading" },
      { afterMs: 350, expectedPrimaryState: "ready" },
    ],
  },
  {
    id: "temporal-loading-to-auth",
    tier: "A",
    description:
      "A visibly loading account shell becomes an authentication wall.",
    route: "/perception/temporal-loading-to-auth",
    tags: ["temporal", "loading", "authentication"],
    checkpoints: [
      { afterMs: 0, expectedPrimaryState: "loading" },
      {
        afterMs: 350,
        expectedPrimaryState: "authentication_required",
      },
    ],
  },
];

const localFixtures: Array<[string, PerceptionFixture]> =
  LOCAL_PERCEPTION_CASES.flatMap((benchmarkCase) => {
    const definition = DEFINITIONS.find(
      (candidate) => candidate.id === benchmarkCase.id,
    );

    if (
      benchmarkCase.route === undefined ||
      definition?.fixture === undefined
    ) {
      return [];
    }

    return [[benchmarkCase.route, definition.fixture]];
  });

export const LOCAL_PERCEPTION_FIXTURES: Record<string, PerceptionFixture> = {
  ...Object.fromEntries(localFixtures),
  "/perception/frame/recaptcha": {
    body: documentHtml(
      "Provider frame",
      "<main>reCAPTCHA provider integration placeholder</main>",
    ),
    status: 200,
  },
  "/perception/temporal-ready-to-verification": {
    body: TEMPORAL_READY_TO_VERIFICATION,
    status: 200,
  },
  "/perception/temporal-loading-to-ready": {
    body: TEMPORAL_LOADING_TO_READY,
    status: 200,
  },
  "/perception/temporal-loading-to-auth": {
    body: TEMPORAL_LOADING_TO_AUTH,
    status: 200,
  },
};
