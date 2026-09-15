import { readFile, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";

export const OBSERVATION_CLASSIFICATIONS = new Set([
  "CUSTOMER_FLOW_BLOCKER",
  "MENTAL_MODEL_CONFUSION",
  "INFORMATION_HIERARCHY_ISSUE",
  "VISUAL_LAYOUT_ISSUE",
  "COPY_CONFUSION",
  "RECOVERY_PATH_ISSUE",
  "NON_BLOCKING_NOTE",
]);

export function sanitizeText(value) {
  return String(value)
    .replace(/\b[A-Z0-9]{4}-[A-Z0-9]{4}\b/g, "[redacted-device-code]")
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[redacted-email]")
    .replace(
      /\b(token|secret|cookie|authorization|password)\s*[=:]\s*\S+/gi,
      "$1=[redacted]",
    )
    .replace(/\/(?:Users|home)\/[^\s"']+/g, "[redacted-local-path]")
    .replace(/[A-Za-z]:\\Users\\[^\s"']+/g, "[redacted-local-path]")
    .replace(
      /(?:https?|ws):\/\/127\.0\.0\.1:\d+\/\S*/g,
      "[redacted-local-endpoint]",
    );
}

export function relevantSurfaceSnapshot(state) {
  const product = state?.product;
  return {
    revision: state?.revision ?? null,
    surface: state?.surface
      ? {
          presentation: state.surface.presentation,
          browserContext: state.surface.browserContext,
          activeHost: state.surface.activeHost,
        }
      : null,
    notice:
      state?.notice === null || state?.notice === undefined
        ? null
        : {
            type: state.notice.type,
            title: sanitizeText(state.notice.title ?? ""),
            message: sanitizeText(state.notice.message ?? ""),
          },
    companion: state?.companion?.session
      ? {
          mode: state.companion.session.mode,
          status: state.companion.session.status,
          controller: state.companion.session.controller,
        }
      : null,
    product:
      product === null || product === undefined
        ? null
        : {
            host: {
              state: product.host?.state ?? null,
              ready: product.host?.ready ?? false,
              compatibility: product.host?.compatibility
                ? {
                    version: product.host.compatibility.version,
                    platform: product.host.compatibility.platform,
                    architecture: product.host.compatibility.architecture,
                    source: product.host.compatibility.source,
                  }
                : null,
            },
            account: product.catalog?.account
              ? {
                  status: product.catalog.account.status,
                  authMode: product.catalog.account.authMode ?? null,
                  planType: product.catalog.account.planType ?? null,
                  error: sanitizeText(product.catalog.account.error ?? ""),
                }
              : null,
            login: product.catalog?.login
              ? { type: product.catalog.login.type }
              : null,
            modelCount: product.catalog?.models?.length ?? 0,
            currentTaskId: product.currentTaskId ? "[present]" : null,
            tasks: (product.tasks ?? []).map((task) => ({
              identity: "[task]",
              executionMode: task.executionMode,
              lifecycle: task.lifecycle?.phase ?? null,
              turnStatus: task.conversation?.turnStatus ?? null,
            })),
            workflowCount: product.workflows?.length ?? 0,
            attentionCount: product.attention?.length ?? 0,
            fileAttentionCount: product.fileAttention?.length ?? 0,
            recoveryWarningCount: product.recoveryWarnings?.length ?? 0,
          },
    productError: sanitizeText(state?.productError ?? ""),
  };
}

export function validateObservations(observations) {
  for (const observation of observations) {
    if (!OBSERVATION_CLASSIFICATIONS.has(observation.classification)) {
      throw new Error(
        `Unsupported customer-journey classification ${observation.classification}.`,
      );
    }
    if (!observation.text?.trim())
      throw new Error("Customer-journey observations require text.");
  }
  return observations;
}

export function groupObservations(observations) {
  const grouped = Object.fromEntries(
    [...OBSERVATION_CLASSIFICATIONS].map((classification) => [
      classification,
      [],
    ]),
  );
  for (const observation of validateObservations(observations)) {
    grouped[observation.classification].push({
      step: observation.step,
      text: sanitizeText(observation.text),
    });
  }
  return grouped;
}

function escapeMarkdown(value) {
  return sanitizeText(value).replaceAll("|", "\\|");
}

export function formatJourneySummary(manifest) {
  const grouped = groupObservations(manifest.observations);
  const steps = manifest.steps
    .map(
      (step) =>
        `| ${String(step.number).padStart(2, "0")} | ${escapeMarkdown(step.userIntent)} | ${escapeMarkdown(step.actionTaken)} | \`${step.screenshot}\` |`,
    )
    .join("\n");
  const observations = Object.entries(grouped)
    .map(([classification, entries]) => {
      const body = entries.length
        ? entries
            .map((entry) => `- Step ${entry.step}: ${entry.text}`)
            .join("\n")
        : "- None observed.";
      return `### ${classification}\n\n${body}`;
    })
    .join("\n\n");
  return `# ${manifest.title}\n\n## Exact baseline\n\n- Commit: \`${manifest.baseline.commit}\`\n- Git state: ${manifest.baseline.gitState}\n- Product home: ${manifest.baseline.productHome}\n- Electron data: ${manifest.baseline.electronData}\n- Account/cloud history: ${manifest.baseline.accountState}\n- External effects: ${manifest.baseline.externalEffects}\n- Viewports: ${manifest.baseline.viewports.map((viewport) => `${viewport.width}×${viewport.height}`).join(", ")}\n\n## Ordered journey\n\n| Step | User intent | Action taken | Screenshot |\n| --- | --- | --- | --- |\n${steps}\n\n## Observations by classification\n\n${observations}\n\n## Journey boundary\n\n${manifest.journeyBoundary}\n`;
}

async function visibleCustomerState(page) {
  return page.evaluate(() => {
    const visible = (element) => {
      if (!(element instanceof HTMLElement)) return false;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        Number(style.opacity) > 0 &&
        rect.width > 0 &&
        rect.height > 0
      );
    };
    const label = (element) =>
      (element.getAttribute("aria-label") || element.textContent || "")
        .trim()
        .replace(/\s+/g, " ");
    const actions = [...document.querySelectorAll("button, a")]
      .filter(visible)
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          label: label(element),
          kind: element.tagName.toLowerCase(),
          primary: element.classList.contains("primary"),
          disabled:
            element instanceof HTMLButtonElement ? element.disabled : false,
          title: element.getAttribute("title") || "",
          fullyInViewport:
            rect.left >= 0 &&
            rect.top >= 0 &&
            rect.right <= innerWidth &&
            rect.bottom <= innerHeight,
        };
      });
    const textBlocks = [
      ...document.querySelectorAll(
        "h1, h2, h3, [role=heading], [role=alert], .eyebrow, .side-heading, main strong, main p, main small",
      ),
    ]
      .filter(visible)
      .map(label)
      .filter(Boolean)
      .filter((value, index, values) => values.indexOf(value) === index)
      .slice(0, 100);
    const partiallyOutsideViewport = [
      ...document.querySelectorAll(
        "button, input, textarea, select, [role=alert], [role=dialog], .product-topbar, .product-sidebar, .product-main, .product-inspector, .composer-input-shell",
      ),
    ]
      .filter(visible)
      .flatMap((element) => {
        const rect = element.getBoundingClientRect();
        return rect.left < 0 ||
          rect.top < 0 ||
          rect.right > innerWidth ||
          rect.bottom > innerHeight
          ? [
              {
                target:
                  element.getAttribute("aria-label") ||
                  element.getAttribute("role") ||
                  element.className ||
                  element.tagName,
                rect: {
                  left: Math.round(rect.left),
                  top: Math.round(rect.top),
                  right: Math.round(rect.right),
                  bottom: Math.round(rect.bottom),
                },
              },
            ]
          : [];
      });
    return {
      viewport: { width: innerWidth, height: innerHeight },
      visibleText: (document.body.innerText || "").trim(),
      visibleHeadingsAndText: textBlocks,
      visibleActions: actions,
      availablePrimaryActions: actions.filter(
        (action) => action.primary && !action.disabled,
      ),
      disabledActions: actions.filter((action) => action.disabled),
      layout: {
        documentWidth: document.documentElement.scrollWidth,
        documentHeight: document.documentElement.scrollHeight,
        horizontalOverflow:
          document.documentElement.scrollWidth >
          document.documentElement.clientWidth,
        verticalOverflow:
          document.documentElement.scrollHeight >
          document.documentElement.clientHeight,
        partiallyOutsideViewport,
      },
    };
  });
}

export async function captureJourneyStep({
  page,
  outputRoot,
  artifactRoot,
  number,
  slug,
  userIntent,
  actionTaken,
  importantObservations = [],
}) {
  const filename = `${String(number).padStart(2, "0")}-${slug}.png`;
  const path = join(outputRoot, filename);
  await page.screenshot({ path, fullPage: false });
  const customerState = await visibleCustomerState(page);
  const rawSnapshot = await page
    .evaluate(() => globalThis.rove.getSurfaceSnapshot())
    .catch(() => null);
  const route = {
    title: sanitizeText(await page.title()),
    url:
      page.url().startsWith("file:") ||
      page.url().startsWith("http://127.0.0.1")
        ? "[local-product-surface]"
        : sanitizeText(page.url()),
    presentation: rawSnapshot?.surface?.presentation ?? null,
    view: sanitizeText(
      (await page
        .locator(".product-task-nav > strong")
        .innerText()
        .catch(() => "")) || "unknown",
    ),
    currentTaskIdentity: rawSnapshot?.product?.currentTaskId
      ? "[present]"
      : null,
    mainSurface:
      (await page
        .locator("main")
        .getAttribute("aria-label")
        .catch(() => null)) ?? null,
  };
  return {
    number,
    userIntent: sanitizeText(userIntent),
    actionTaken: sanitizeText(actionTaken),
    screenshot: relative(artifactRoot, path),
    visibleUi: {
      viewport: customerState.viewport,
      headingsAndText: customerState.visibleHeadingsAndText.map(sanitizeText),
      fullText: sanitizeText(customerState.visibleText),
      availablePrimaryActions: customerState.availablePrimaryActions.map(
        (action) => ({ ...action, label: sanitizeText(action.label) }),
      ),
      disabledActions: customerState.disabledActions.map((action) => ({
        ...action,
        label: sanitizeText(action.label),
      })),
      visibleActions: customerState.visibleActions.map((action) => ({
        ...action,
        label: sanitizeText(action.label),
      })),
    },
    applicationState: relevantSurfaceSnapshot(rawSnapshot),
    route,
    layout: customerState.layout,
    importantObservations: importantObservations.map(sanitizeText),
  };
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export async function renderJourneyContactSheet({
  chromium,
  outputRoot,
  steps,
}) {
  const cells = await Promise.all(
    steps.map(async (step) => ({
      ...step,
      image: `data:image/png;base64,${(
        await readFile(join(outputRoot, step.screenshot))
      ).toString("base64")}`,
    })),
  );
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 1560, height: 900 },
    });
    await page.setContent(`<!doctype html><meta charset="utf-8"><style>
      *{box-sizing:border-box}body{margin:0;padding:28px;background:#efefec;color:#20201e;font:14px -apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI",sans-serif}
      h1{margin:0 0 22px;font-size:24px}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px}.cell{overflow:hidden;border:1px solid #d9d9d4;border-radius:14px;background:#fff;box-shadow:0 8px 24px rgba(0,0,0,.06)}
      .meta{padding:11px 13px;border-bottom:1px solid #eaeae6}.meta strong{display:block;font-size:13px}.meta span{display:block;margin-top:4px;color:#676762;font-size:11px;line-height:1.35}.cell img{display:block;width:100%;height:auto}
    </style><h1>First-launch customer journey</h1><div class="grid">${cells
      .map(
        (step) =>
          `<article class="cell"><div class="meta"><strong>${String(step.number).padStart(2, "0")} · ${escapeHtml(step.userIntent)}</strong><span>${escapeHtml(step.actionTaken)}</span></div><img src="${step.image}"></article>`,
      )
      .join("")}</div>`);
    await page.screenshot({
      path: join(outputRoot, "contact-sheet.png"),
      fullPage: true,
    });
  } finally {
    await browser.close();
  }
}

export async function writeJourneyArtifacts({ outputRoot, manifest }) {
  validateObservations(manifest.observations);
  await writeFile(
    join(outputRoot, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  await writeFile(
    join(outputRoot, "summary.md"),
    formatJourneySummary(manifest),
  );
}
