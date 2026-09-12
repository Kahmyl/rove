import { readFile } from "node:fs/promises";
import { createServer } from "node:http";

import { LOCAL_PERCEPTION_FIXTURES } from "../perception/corpus/local-corpus.js";

export interface FixtureServer {
  readonly port: number;
  readonly url: string;
  mutationCount(): number;
  close(): Promise<void>;
}

// Resolve through src so the deterministic asset is also available when this
// module is loaded from the compiled dist directory.
const INSPECTION_HTML_URL = new URL(
  "../../src/fixtures/pages/inspection.html",
  import.meta.url,
);

const POPUP_HTML = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Rove Popup Fixture</title></head>
  <body>
    <p>Popup opener</p>
    <script>window.open("/", "_blank");</script>
  </body>
</html>
`;

const ACTIONS_HTML = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Rove Actions Fixture</title></head>
  <body style="margin:0">
    <main>
      <h1>Browser actions</h1>
      <form id="search-form">
        <label for="search">Search</label><input id="search" name="search" value="old text" />
        <label for="password">Password</label><input id="password" name="password" type="password" />
        <label for="otp">One-time code</label><input id="otp" name="otp" autocomplete="one-time-code" />
        <label for="sort">Sort</label>
        <select id="sort" name="sort">
          <option value="newest">Newest</option>
          <option value="oldest">Oldest</option>
        </select>
        <button id="submit" type="submit">Submit search</button>
      </form>
      <label for="direct-file">Direct file</label><input id="direct-file" type="file" />
      <button id="file-upload-trigger" type="button">File upload trigger</button>
      <input id="chooser-file" type="file" hidden />
      <p id="result-state">idle</p>
      <button id="change-state">Change state</button>
      <button id="navigate" onclick="location.href='/result'">Navigate result</button>
      <button id="open-popup" onclick="window.open('/popup-target','_blank')">Open popup</button>
      <button id="show-alert" onclick="alert('fixture alert')">Show alert</button>
      <button id="show-confirm" onclick="document.body.dataset.confirmResult = String(confirm('fixture confirm'))">Show confirm</button>
      <button id="show-prompt" onclick="document.body.dataset.promptResult = String(prompt('fixture prompt', 'secret'))">Show prompt</button>
      <button id="set-beforeunload">Set beforeunload</button>
      <button id="disabled" disabled>Disabled action</button>
      <button id="hide-target">Hide target</button>
      <button id="becomes-hidden">Becomes hidden</button>
      <button id="mutate-unrelated">Mutate unrelated</button>
      <div id="unrelated">unchanged</div>
      <p id="scroll-state">not scrolled</p>
      <div style="height:2200px;background:linear-gradient(#fff,#ddd)">Scrollable long content</div>
    </main>
    <script>
      document.querySelector('#search-form').addEventListener('submit', event => {
        event.preventDefault();
        document.querySelector('#result-state').textContent = 'submitted:' + document.querySelector('#search').value;
      });
      document.querySelector('#search').addEventListener('keydown', event => {
        if (event.key === 'Enter') document.body.dataset.enterPressed = 'true';
      });
      document.querySelector('#change-state').addEventListener('click', event => event.currentTarget.textContent = 'State changed');
      document.querySelector('#file-upload-trigger').addEventListener('click', () => document.querySelector('#chooser-file').click());
      document.querySelector('#chooser-file').addEventListener('change', event => {
        const name = event.currentTarget.files?.item(0)?.name ?? 'none';
        document.querySelector('#result-state').textContent = 'uploaded:' + name;
      });
      document.querySelector('#hide-target').addEventListener('click', () => document.querySelector('#becomes-hidden').style.display = 'none');
      document.querySelector('#mutate-unrelated').addEventListener('click', () => document.querySelector('#unrelated').textContent = 'changed');
      document.querySelector('#set-beforeunload').addEventListener('click', () => {
        window.onbeforeunload = () => 'fixture beforeunload';
        document.body.dataset.beforeunloadSet = 'true';
      });
      addEventListener('scroll', () => document.querySelector('#scroll-state').textContent = 'scrolled:' + Math.round(scrollY), { passive: true });
    </script>
  </body>
</html>`;

const RESULT_HTML = `<!doctype html><html><head><title>Rove Result Fixture</title></head><body><h1>Result page</h1><a href="/actions">Back to actions</a></body></html>`;
const TOKEN_SEQUENCE_GROUNDING_HTML = `<!doctype html><html><head><title>Token sequence grounding</title></head><body>
  <main>
    <h1>Reports</h1>
    <button>Account settings</button>
    <button>Download invoice</button>
    <button>Open annual statement</button>
    <button>View tax documents</button>
    <button>Print current page</button>
    <button>Contact support</button>
    <a id="quarterly-report-pdf" href="/result">2026 Quarterly Report (PDF)</a>
  </main>
</body></html>`;
const SHADOW_SCROLL_HTML = `<!doctype html><html><head><title>Shadow scroll fixture</title></head><body>
  <h1>Embedded document surface</h1>
  <div id="host"></div>
  <p id="shadow-scroll-state">not scrolled</p>
  <script>
    const root = document.querySelector('#host').attachShadow({ mode: 'open' });
    root.innerHTML = '<div id="viewer" style="height:600px;overflow:auto"><div style="height:1800px">Document pages</div></div>';
    root.querySelector('#viewer').addEventListener('scroll', event => {
      document.querySelector('#shadow-scroll-state').textContent = 'shadow-scrolled:' + Math.round(event.currentTarget.scrollTop);
    }, { passive: true });
  </script>
</body></html>`;
const CONSEQUENTIAL_ACTION_HTML = `<!doctype html><html><head><title>Consequential action</title></head><body>
  <form action="/consequential-mutation" method="post">
    <button type="submit">Apply consequential mutation</button>
  </form>
</body></html>`;
const consequentialFormHtml = (churn: string) =>
  `<!doctype html><html><head><title>Consequential form</title></head><body>
  <form aria-label="Create record" action="/consequential-form-submit" method="post">
    <input type="hidden" name="csrf" value="${churn}" />
    <label for="record-title">Record title</label>
    <input id="record-title" name="title" value="" />
    <label for="record-notes">Record notes</label>
    <textarea id="record-notes" name="notes"></textarea>
    <button type="submit" name="commit" value="create">Create record</button>
  </form>
  <p id="unrelated-churn">Render marker: ${churn}</p>
</body></html>`;
const CONSEQUENTIAL_RESULT_HTML = `<!doctype html><html><head><title>Mutation applied</title></head><body><h1>Mutation applied</h1></body></html>`;
const DOWNLOAD_HTML = `<!doctype html><html><head><title>Download fixture</title></head><body>
  <a id="download-file" href="/download.txt">Download file</a>
  <a id="slow-download-file" href="/slow-download.txt">Slow download file</a>
  <button id="schedule-unrelated-download">Schedule unrelated download</button>
  <a id="delayed-requested-download" href="/download.txt">Delayed requested download</a>
  <a id="failed-download-probe" href="/failed-download-probe" onclick="event.preventDefault()">Failed download probe</a>
  <button id="button-download">Button download</button>
  <button id="button-download-twice">Button download twice</button>
  <script>
    const trigger = href => {
      const link = document.createElement('a');
      link.href = href;
      link.download = '';
      document.body.append(link);
      link.click();
      link.remove();
    };
    document.querySelector('#schedule-unrelated-download').addEventListener('click', () => {
      setTimeout(() => trigger('/download.txt'), 1000);
    });
    document.querySelector('#delayed-requested-download').addEventListener('click', event => {
      event.preventDefault();
      setTimeout(() => trigger('/download.txt'), 1500);
    });
    document.querySelector('#button-download').addEventListener('click', () => trigger('/download.txt'));
    document.querySelector('#button-download-twice').addEventListener('click', () => {
      trigger('/download.txt');
      trigger('/download.txt');
    });
  </script>
</body></html>`;

function fixturePdf(): Buffer {
  const stream = "BT\n/F1 24 Tf\n72 720 Td\n(Rove PDF fixture) Tj\nET\n";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let body = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("");
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(body);
}
const HISTORY_A_HTML = `<!doctype html><html><head><title>History A</title></head><body><h1>History A</h1><a href="/history-b">History B</a></body></html>`;
const HISTORY_B_HTML = `<!doctype html><html><head><title>History B</title></head><body><h1>History B</h1></body></html>`;
const IFRAME_HTML = `<!doctype html><html><head><title>Iframe fixture</title></head><body>
  <h1>Iframe fixture</h1>
  <button id="outer-button">Outer frame button</button>
  <iframe title="Same origin frame" src="/same-origin-frame"></iframe>
  <iframe id="cross-origin-frame" title="Cross origin frame"></iframe>
  <script>
    document.querySelector('#cross-origin-frame').src =
      location.href.replace('127.0.0.1', 'localhost').replace('/iframes', '/cross-origin-frame');
  </script>
</body></html>`;
const SAME_ORIGIN_FRAME_HTML = `<!doctype html><html><body>
  <p>same origin frame loaded</p>
  <button id="same-frame-button">Same frame button</button>
  <script>
    document.querySelector('#same-frame-button').addEventListener('click', event => {
      event.currentTarget.textContent = 'Same frame clicked';
    });
  </script>
</body></html>`;
const CROSS_ORIGIN_FRAME_HTML = `<!doctype html><html><body>
  <p>cross origin frame loaded</p>
  <button id="cross-frame-button">Cross frame button</button>
</body></html>`;
const POPUP_TARGET_HTML = `<!doctype html><html><head><title>Popup target</title></head><body><h1>Popup target</h1></body></html>`;
const HANDOFF_HTML = `<!doctype html><html><head><title>Human handoff</title></head><body>
  <p id="current">Current value: initial</p>
  <label for="handoff-input">New value</label><input id="handoff-input" value="initial" />
  <button id="handoff-update">Update</button>
  <script>document.querySelector('#handoff-update').addEventListener('click',()=>{document.querySelector('#current').textContent='Current value: '+document.querySelector('#handoff-input').value})</script>
</body></html>`;
const ACCESS_RESTRICTED_HTML = `<!doctype html><html><head><title>Access restricted</title></head><body>
  <h1>Access is temporarily restricted</h1>
  <p>We detected unusual activity from your device or network.</p>
</body></html>`;
const HUMAN_VERIFICATION_HTML = `<!doctype html><html><head><title>Security check</title></head><body>
  <h1>Complete the security check</h1>
  <iframe title="Human verification" src="/captcha-frame"></iframe>
</body></html>`;
const AUTHENTICATION_HTML = `<!doctype html><html><head><title>Sign in</title></head><body>
  <h1>Sign in to continue</h1><label>Email <input type="email" /></label>
</body></html>`;
const UNKNOWN_INTERSTITIAL_HTML = `<!doctype html>
<html>
  <head>
    <title>Challenge</title>
  </head>
  <body>
    <canvas
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
    </script>
  </body>
</html>`;
const SERVER_ERROR_HTML = `<!doctype html><html><head><title>Service unavailable</title></head><body>
  <h1>Service unavailable</h1>
</body></html>`;
const BROWSER_EVIDENCE_HTML = `<!doctype html><html><head><title>Evidence fixture</title></head><body>
  <main><h1>Evidence fixture</h1></main>
  <script>
    console.warn('token=console-secret warning from https://example.test/path?token=url-secret');
    setTimeout(() => { throw new Error('password=page-secret failed'); }, 0);
    fetch('http://127.0.0.1:1/challenge.js?token=request-secret').catch(() => undefined);
  </script>
</body></html>`;
const ARBITRARY_CONSOLE_HTML = `<!doctype html><html><head><title>Console fixture</title></head><body>
  <main><h1>Console fixture</h1></main>
  <script>console.error('Patient Ada Lovelace has a private diagnosis');</script>
</body></html>`;
const CONSOLE_BURST_HTML = `<!doctype html><html><head><title>Console burst</title></head><body>
  <main><h1>Console burst</h1></main>
  <script>for (let index = 0; index < 205; index += 1) console.warn('diagnostic event ' + index);</script>
</body></html>`;
const F2_LOADING_HTML = `<!doctype html>
<html>
  <head><title>Loading workspace</title></head>
  <body>
    <main id="f2-loading-workflow" aria-busy="true">
      <h1>Loading workspace</h1>
      <div role="progressbar" aria-label="Loading workspace"></div>
    </main>
  </body>
</html>`;
const DYNAMIC_TARGET_HTML = `<!doctype html>
<html><head><title>Dynamic target</title></head><body>
  <button id="replace-me">Replace me</button>
  <button id="replace-trigger">Replace target</button>
  <button id="unrelated-trigger">Change unrelated content</button>
  <p id="unrelated">initial</p>
  <script>
    const replaceTarget = () => {
      const old = document.querySelector('#replace-me');
      const replacement = document.createElement('button');
      replacement.id = 'replace-me'; replacement.textContent = 'Replace me';
      replacement.addEventListener('click', () => document.body.dataset.replacementClicked = 'true');
      old.replaceWith(replacement);
    };
    document.querySelector('#replace-trigger').addEventListener('click', replaceTarget);
    document.querySelector('#unrelated-trigger').addEventListener('click', () => document.querySelector('#unrelated').textContent = 'changed');
    if (location.hash === '#replace-later') setTimeout(replaceTarget, 200);
    if (location.hash === '#duplicate-later') setTimeout(() => {
      const original = document.querySelector('#replace-me');
      const duplicate = original.cloneNode(true);
      duplicate.id = 'duplicate';
      original.after(duplicate);
    }, 200);
    if (location.hash === '#unrelated-later') setTimeout(() => document.querySelector('#unrelated').textContent = 'changed', 200);
    if (location.hash === '#hidden-later') setTimeout(() => document.querySelector('#replace-me').style.display = 'none', 200);
  </script>
</body></html>`;

const DYNAMIC_FRESHNESS_HTML = `<!doctype html>
<html><head><title>Dynamic freshness</title></head><body>
  <button id="stable-target">Stable target</button>
  <button id="background-churn">Background 0</button>
  <div id="shadow-host"></div>
  <iframe id="stable-frame" title="Stable target frame" src="/dynamic-freshness-frame"></iframe>
  <div style="height:1800px" aria-hidden="true"></div>
  <script>
    window.__dispatchCount = 0;
    document.querySelector('#stable-target').addEventListener('click', () => {
      window.__dispatchCount += 1;
    });
    const mountShadowTarget = host => {
      const root = host.attachShadow({ mode: 'open' });
      root.innerHTML = '<button id="shadow-stable">Shadow stable target</button>';
      root.querySelector('button').addEventListener('click', () => {
        window.__dispatchCount += 1;
      });
    };
    mountShadowTarget(document.querySelector('#shadow-host'));
    let tick = 0;
    setInterval(() => {
      tick += 1;
      document.querySelector('#background-churn').textContent = 'Background ' + tick;
    }, 5);
  </script>
</body></html>`;

const DYNAMIC_FRESHNESS_FRAME_HTML = `<!doctype html>
<html><head><title>Dynamic freshness frame</title></head><body>
  <button id="frame-stable">Frame stable target</button>
  <script>
    document.querySelector('#frame-stable').addEventListener('click', () => {
      parent.__dispatchCount += 1;
    });
  </script>
</body></html>`;

const INTERACTIVE_RECONCILIATION_HTML = `<!doctype html>
<html><head><title>Interactive reconciliation</title></head><body>
  <svg role="img" aria-label="Decorative status"><circle r="4"></circle></svg>
  <label>Issue actions
    <select><option>Record actions</option></select>
  </label>
  <button id="edit-body">Edit body</button>
  <label><input type="checkbox" /> task one</label>
  <label><input type="checkbox" /> task two</label>
  <div id="editor"></div>
  <script>
    document.querySelector('#edit-body').addEventListener('click', () => {
      document.querySelector('#editor').innerHTML =
        '<label for="body-input">Body input</label><textarea id="body-input"></textarea>' +
        '<button>Cancel</button><button>Save</button>';
    });
  </script>
</body></html>`;

const REACTIVE_EDITOR_HTML = `<!doctype html>
<html><head><title>Reactive editor</title></head><body>
  <label for="body">Body</label><textarea id="body"></textarea>
  <label for="guarded-secret">Password</label>
  <input id="guarded-secret" type="password" />
  <script>
    const body = document.querySelector('#body');
    body.addEventListener('keydown', event => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      const start = body.selectionStart;
      body.setRangeText('\\n- [ ] ', start, body.selectionEnd, 'end');
      body.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertLineBreak' }));
    });
    document.querySelector('#guarded-secret').addEventListener('input', event => {
      if (event.currentTarget.value.includes('force-mismatch')) {
        event.currentTarget.value = 'reactive-rewrite';
      }
    });
  </script>
</body></html>`;

const HYDRATION_CHURN_HTML = `<!doctype html>
<html><head><title>Hydration churn</title></head><body>
  <main id="root"></main>
  <script>
    const markup = Array.from(
      { length: 300 },
      (_, index) => '<button>Action ' + index + '</button>',
    ).join('');
    document.querySelector('#root').innerHTML = markup;
    const timer = setInterval(() => {
      const next = document.createElement('main');
      next.id = 'root';
      next.innerHTML = markup;
      document.querySelector('#root').replaceWith(next);
    }, 5);
    setTimeout(() => clearInterval(timer), 1500);
  </script>
</body></html>`;

const STYLED_LABEL_IDENTITY_HTML = `<!doctype html>
<html><head><title>Styled label identity</title></head><body>
  <form>
    <label for="repository-name" style="display:flex;gap:4px">
      <span>Repository name</span><span>*</span>
    </label>
    <input id="repository-name" type="text" />
  </form>
</body></html>`;

const CAPABILITY_WAVES_HTML = `<!doctype html>
<html><head><title>Capability waves</title>
<style>
  #drag-source,#drop-destination { display:inline-block; width:140px; height:60px; margin:20px; }
</style></head><body>
  <h1>Capability waves</h1>
  <button id="activation">Activate with variants</button>
  <label for="editor">Wave editor</label><input id="editor" value="initial" />
  <label for="range">Priority</label><input id="range" type="range" min="0" max="10" value="4" />
  <button id="switch" role="switch" aria-checked="false">Notifications</button>
  <div role="grid" aria-label="Drive-like files">
    <div id="static-gridcell" role="gridcell" aria-label="Static folder cell">Static folder cell</div>
    <div id="roving-gridcell" role="gridcell" tabindex="-1" aria-label="Roving folder cell">Roving folder cell</div>
  </div>
  <details id="details"><summary>Advanced controls</summary><p>Revealed</p></details>
  <label for="multiple-files">Multiple files</label><input id="multiple-files" type="file" multiple />
  <div id="drag-source" draggable="true" tabindex="0">Draggable card</div>
  <button id="drop-destination" type="button">Drop destination</button>
  <div id="custom-drag-source" tabindex="0">Custom draggable card</div>
  <button id="custom-drop-destination" type="button">Custom drop destination</button>
  <script>
    const activation = document.querySelector('#activation');
    activation.addEventListener('dblclick', () => document.body.dataset.double = 'true');
    activation.addEventListener('contextmenu', event => {
      event.preventDefault(); document.body.dataset.secondary = 'true';
    });
    activation.addEventListener('click', event => {
      if (event.shiftKey) document.body.dataset.modified = 'true';
    });
    const editor = document.querySelector('#editor');
    editor.addEventListener('copy', () => document.body.dataset.copied = 'true');
    editor.addEventListener('cut', event => {
      event.preventDefault(); document.body.dataset.cut = 'true';
    });
    editor.addEventListener('paste', event => {
      event.preventDefault(); document.body.dataset.pasted = 'true';
    });
    document.querySelector('#switch').addEventListener('click', event => {
      const next = event.currentTarget.getAttribute('aria-checked') !== 'true';
      event.currentTarget.setAttribute('aria-checked', String(next));
    });
    document.querySelector('#static-gridcell').addEventListener('keydown', event => {
      document.body.dataset.staticGridKey = event.key;
    });
    document.querySelector('#roving-gridcell').addEventListener('keydown', event => {
      document.body.dataset.rovingGridKey = event.key;
    });
    document.querySelector('#multiple-files').addEventListener('change', event => {
      document.body.dataset.files = Array.from(event.currentTarget.files).map(file => file.name).join(',');
    });
    const source = document.querySelector('#drag-source');
    const destination = document.querySelector('#drop-destination');
    source.addEventListener('dragstart', event => event.dataTransfer.setData('text/plain', 'card'));
    destination.addEventListener('dragover', event => event.preventDefault());
    destination.addEventListener('drop', event => {
      event.preventDefault();
      if (event.dataTransfer.getData('text/plain') === 'card') document.body.dataset.dropped = 'true';
    });
    const customSource = document.querySelector('#custom-drag-source');
    const customDestination = document.querySelector('#custom-drop-destination');
    let customStartedAt = 0;
    let customReached = false;
    customSource.addEventListener('pointerdown', event => {
      customStartedAt = performance.now();
      customReached = false;
      event.currentTarget.setPointerCapture(event.pointerId);
    });
    customSource.addEventListener('pointermove', event => {
      if (event.buttons !== 1 || performance.now() - customStartedAt < 100) return;
      const bounds = customDestination.getBoundingClientRect();
      customReached =
        event.clientX >= bounds.left && event.clientX <= bounds.right &&
        event.clientY >= bounds.top && event.clientY <= bounds.bottom;
    });
    customSource.addEventListener('pointerup', () => {
      if (customReached) document.body.dataset.customDropped = 'true';
    });
  </script>
</body></html>`;

const SEMANTIC_TRANSFER_HTML = `<!doctype html>
<html><head><title>Semantic transfer</title></head><body>
  <h1>Semantic transfer</h1>
  <ul aria-label="Inbox" id="inbox">
    <li id="report-row"><button id="report" aria-haspopup="menu">Quarterly report</button></li>
  </ul>
  <ul aria-label="Archive" id="archive"></ul>
  <div role="menu" aria-label="Move actions" id="move-actions" hidden>
    <button role="menuitem" id="move-to-archive">Move to Archive</button>
  </div>
  <p id="transfer-state">Ready</p>
  <script>
    const report = document.querySelector('#report');
    const menu = document.querySelector('#move-actions');
    report.addEventListener('click', () => {
      menu.hidden = false;
      report.setAttribute('aria-expanded', 'true');
    });
    document.querySelector('#move-to-archive').addEventListener('click', () => {
      menu.hidden = true;
      report.setAttribute('aria-expanded', 'false');
      setTimeout(() => {
        const row = document.querySelector('#report-row');
        document.querySelector('#archive').append(row);
        document.querySelector('#transfer-state').textContent = 'Moved to Archive';
        document.body.dataset.transferCount = String(Number(document.body.dataset.transferCount || '0') + 1);
      }, 75);
    });
  </script>
</body></html>`;

const SEMANTIC_CLIPBOARD_TRANSFER_HTML = `<!doctype html>
<html><head><title>Semantic clipboard transfer</title></head><body>
  <h1>Semantic clipboard transfer</h1>
  <div role="grid" aria-label="Files">
    <div role="row" aria-selected="true">
      <div role="gridcell" tabindex="0">Quarterly report</div>
    </div>
  </div>
  <p id="clipboard-state">Selected</p>
  <script>
    document.addEventListener('keydown', event => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'x') {
        document.querySelector('#clipboard-state').textContent = 'Cut received';
      }
    });
  </script>
</body></html>`;

/**
 * Tiny deterministic fixture server for tests and manual demos.
 * Binds to 127.0.0.1 on an ephemeral port and serves the inspection fixture.
 */
export async function startFixtureServer(): Promise<FixtureServer> {
  const inspectionHtml = await readFile(INSPECTION_HTML_URL, "utf8");
  let mutationCount = 0;
  const server = createServer((request, response) => {
    if (
      request.method === "POST" &&
      request.url === "/consequential-mutation"
    ) {
      mutationCount += 1;
      response.writeHead(303, { location: "/consequential-result" });
      response.end();
      return;
    }

    if (
      request.method === "POST" &&
      request.url === "/consequential-form-submit"
    ) {
      request.resume();
      request.once("end", () => {
        mutationCount += 1;
        response.writeHead(303, { location: "/consequential-result" });
        response.end();
      });
      return;
    }

    if (request.url?.startsWith("/consequential-form") === true) {
      const churn = new URL(
        request.url,
        "http://fixture.test",
      ).searchParams.get("churn");
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(consequentialFormHtml(churn ?? "default"));
      return;
    }

    if (request.url === "/evidence-redirect") {
      response.writeHead(302, {
        location: "/evidence-terminal?token=redirect-secret",
      });
      response.end();
      return;
    }

    if (request.url?.startsWith("/evidence-terminal") === true) {
      response.writeHead(451, { "content-type": "text/html; charset=utf-8" });
      response.end(BROWSER_EVIDENCE_HTML);
      return;
    }

    if (request.url === "/arbitrary-console") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(ARBITRARY_CONSOLE_HTML);
      return;
    }

    if (request.url === "/console-burst") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(CONSOLE_BURST_HTML);
      return;
    }

    if (request.url === "/download.txt") {
      response.writeHead(200, {
        "content-disposition":
          'attachment; filename="rove-session-download.txt"',
        "content-type": "text/plain; charset=utf-8",
      });
      response.end("rove session download");
      return;
    }

    if (request.url === "/slow-download.txt") {
      response.writeHead(200, {
        "content-disposition": 'attachment; filename="rove-slow-download.txt"',
        "content-type": "text/plain; charset=utf-8",
      });
      setTimeout(() => response.end("rove slow session download"), 300);
      return;
    }

    if (request.url === "/unrelated-download.txt") {
      response.writeHead(200, {
        "content-disposition": 'attachment; filename="unrelated.txt"',
        "content-type": "text/plain; charset=utf-8",
      });
      response.end("unrelated delayed download");
      return;
    }

    if (request.url === "/fixture.pdf") {
      response.writeHead(200, {
        "content-disposition": 'inline; filename="rove-fixture.pdf"',
        "content-type": "application/pdf",
      });
      response.end(fixturePdf());
      return;
    }

    const fixture: string | { body: string; status: number } =
      {
        "/": inspectionHtml,
        "/popup": POPUP_HTML,
        "/actions": ACTIONS_HTML,
        "/result": RESULT_HTML,
        "/token-sequence-grounding": TOKEN_SEQUENCE_GROUNDING_HTML,
        "/shadow-scroll": SHADOW_SCROLL_HTML,
        "/consequential-action": CONSEQUENTIAL_ACTION_HTML,
        "/consequential-result": CONSEQUENTIAL_RESULT_HTML,
        "/download": DOWNLOAD_HTML,
        "/history-a": HISTORY_A_HTML,
        "/history-b": HISTORY_B_HTML,
        "/iframes": IFRAME_HTML,
        "/same-origin-frame": SAME_ORIGIN_FRAME_HTML,
        "/cross-origin-frame": CROSS_ORIGIN_FRAME_HTML,
        "/popup-target": POPUP_TARGET_HTML,
        "/handoff": HANDOFF_HTML,
        "/access-restricted": ACCESS_RESTRICTED_HTML,
        "/human-verification": HUMAN_VERIFICATION_HTML,
        "/captcha-frame": "<!doctype html><html><body>hCaptcha</body></html>",
        "/authentication": AUTHENTICATION_HTML,
        "/unknown-interstitial": UNKNOWN_INTERSTITIAL_HTML,
        "/server-error": { body: SERVER_ERROR_HTML, status: 503 },
        "/loading": F2_LOADING_HTML,
        "/dynamic-target": DYNAMIC_TARGET_HTML,
        "/dynamic-freshness": DYNAMIC_FRESHNESS_HTML,
        "/dynamic-freshness-frame": DYNAMIC_FRESHNESS_FRAME_HTML,
        "/interactive-reconciliation": INTERACTIVE_RECONCILIATION_HTML,
        "/reactive-editor": REACTIVE_EDITOR_HTML,
        "/hydration-churn": HYDRATION_CHURN_HTML,
        "/styled-label-identity": STYLED_LABEL_IDENTITY_HTML,
        "/capability-waves": CAPABILITY_WAVES_HTML,
        "/semantic-transfer": SEMANTIC_TRANSFER_HTML,
        "/semantic-clipboard-transfer": SEMANTIC_CLIPBOARD_TRANSFER_HTML,
        ...LOCAL_PERCEPTION_FIXTURES,
      }[request.url ?? "/"] ?? inspectionHtml;
    response.writeHead(typeof fixture === "string" ? 200 : fixture.status, {
      "content-type": "text/html; charset=utf-8",
    });
    response.end(typeof fixture === "string" ? fixture : fixture.body);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    server.close();
    throw new Error("Fixture server did not bind to a TCP port.");
  }
  return {
    port: address.port,
    url: `http://127.0.0.1:${address.port}`,
    mutationCount: () => mutationCount,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
