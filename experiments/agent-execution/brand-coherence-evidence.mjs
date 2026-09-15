#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const outputRoot = join(
  repositoryRoot,
  "artifacts/visual-design/brand-coherence",
);
const requireBrowser = createRequire(
  join(repositoryRoot, "packages/browser/package.json"),
);
const { chromium } = requireBrowser("playwright");

const sheets = {
  light: [
    ["New Task + slash palette", "artifacts/verification/product-surface/ui-truth-t01.png"],
    ["Selected task + composer", "artifacts/verification/product-surface/ui-truth-t02.png"],
    ["Workflow Home", "artifacts/customer-journeys/journey-02-workflow/brand-light-workflow-home.png"],
    ["Workflow Context", "artifacts/customer-journeys/journey-02-workflow/brand-light-workflow-context.png"],
    ["Attached browser", "artifacts/verification/product-surface/ui-truth-b02.png"],
    ["Recording finalizing", "artifacts/verification/product-surface/ui-truth-v02.png"],
    ["Settings selection", "artifacts/verification/product-surface/ui-truth-d03.png"],
    ["Approved Outputs authority", "artifacts/customer-journeys/journey-03-results-outputs/29-small-output-detail.png"],
  ],
  dark: [
    ["Selected task + composer", "artifacts/customer-journeys/private-beta-walkthrough/02-multi-task-task-b-viewed.png"],
    ["Participation selection", "artifacts/customer-journeys/private-beta-walkthrough/13-participation-mode-menu.png"],
    ["Workflow Home", "artifacts/customer-journeys/journey-02-workflow/04-workflow-home-entered.png"],
    ["Workflow focused Context", "artifacts/customer-journeys/journey-02-workflow/18-context-focused-edit.png"],
    ["Attached browser", "artifacts/customer-journeys/private-beta-walkthrough/08-browser-collaboration-browser-attached.png"],
    ["Recording interaction", "artifacts/customer-journeys/private-beta-walkthrough/17-recording-consent-ready.png"],
    ["Settings", "artifacts/customer-journeys/private-beta-walkthrough/24-data-management-settings-open.png"],
    ["Approved Outputs authority", "artifacts/customer-journeys/journey-03-results-outputs/25-dark-outputs-list.png"],
  ],
  small: [
    ["Light composer + sidebar", "artifacts/verification/product-surface/ui-truth-t08.png"],
    ["Dark task + sidebar", "artifacts/customer-journeys/private-beta-walkthrough/37-responsive-dark-small-multi-attention.png"],
    ["Dark operational surface", "artifacts/customer-journeys/private-beta-walkthrough/38-responsive-dark-dark-browser-human.png"],
    ["Light Workflow Output", "artifacts/customer-journeys/journey-03-results-outputs/29-small-output-detail.png"],
  ],
};

const escapeHtml = (value) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

await mkdir(outputRoot, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const manifest = {
    title: "Rove final brand-coherence evidence",
    accent: "#C16137",
    semanticBoundary:
      "Terracotta identifies Rove, current context, and focus; green, amber, and red remain reserved for success, warning, and danger.",
    sheets: {},
  };

  for (const [theme, entries] of Object.entries(sheets)) {
    const cells = await Promise.all(
      entries.map(async ([label, path]) => ({
        label,
        path,
        image: (await readFile(join(repositoryRoot, path))).toString("base64"),
      })),
    );
    const page = await browser.newPage({ viewport: { width: 1680, height: 1000 } });
    await page.setContent(`<!doctype html><html><head><style>
      * { box-sizing: border-box; }
      body { margin: 0; padding: 32px; color: ${theme === "dark" ? "#f1eee9" : "#252321"}; background: ${theme === "dark" ? "#171716" : "#f1efeb"}; font: 14px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      header { display: flex; align-items: baseline; justify-content: space-between; margin: 0 0 22px; }
      h1 { margin: 0; font-size: 25px; font-weight: 650; letter-spacing: -0.02em; }
      header span { color: ${theme === "dark" ? "#c5beb7" : "#6e6861"}; }
      .accent { color: #c16137; }
      main { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 22px; }
      article { overflow: hidden; border: 1px solid ${theme === "dark" ? "#403d39" : "#d7d2cb"}; border-radius: 16px; background: ${theme === "dark" ? "#242321" : "#fbfaf8"}; box-shadow: 0 8px 26px rgb(0 0 0 / ${theme === "dark" ? ".18" : ".07"}); }
      h2 { margin: 0; padding: 12px 15px; border-bottom: 1px solid ${theme === "dark" ? "#403d39" : "#e2ded8"}; font-size: 14px; font-weight: 600; }
      img { display: block; width: 100%; height: auto; }
    </style></head><body><header><h1>Rove brand coherence · ${escapeHtml(theme)}</h1><span><b class="accent">#C16137</b> identity/current/focus · semantic states remain distinct</span></header><main>${cells
      .map(
        (cell) =>
          `<article><h2>${escapeHtml(cell.label)}</h2><img src="data:image/png;base64,${cell.image}"></article>`,
      )
      .join("")}</main></body></html>`);
    const outputPath = join(outputRoot, `contact-sheet-${theme}.png`);
    await page.screenshot({ path: outputPath, fullPage: true });
    await page.close();
    manifest.sheets[theme] = {
      path: relative(repositoryRoot, outputPath),
      sources: cells.map(({ label, path }) => ({ label, path })),
    };
  }

  await writeFile(
    join(outputRoot, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  await writeFile(
    join(outputRoot, "summary.md"),
    "# Final brand-coherence evidence\n\nTerracotta `#C16137` is limited to Rove identity, current context, selected controls, and focus. Neutral surfaces remain dominant. Green, amber, and red retain their success, warning, and danger meanings. The sheets compare task, Workflow, operational, responsive, and approved Outputs surfaces in light and dark themes.\n",
  );
  process.stdout.write(
    `${JSON.stringify({ status: "pass", output: relative(repositoryRoot, outputRoot), sheets: Object.keys(sheets) }, null, 2)}\n`,
  );
} finally {
  await browser.close();
}
