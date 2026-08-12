import { readFile } from "node:fs/promises";
import { createServer } from "node:http";

export interface FixtureServer {
  readonly port: number;
  readonly url: string;
  close(): Promise<void>;
}

// Resolve through src so the deterministic asset is also available when this
// module is loaded from the compiled dist directory.
const INSPECTION_HTML_URL = new URL("../../src/fixtures/pages/inspection.html", import.meta.url);

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
const DOWNLOAD_HTML = `<!doctype html><html><head><title>Download fixture</title></head><body><a id="download-file" href="/download.txt">Download file</a></body></html>`;
const HISTORY_A_HTML = `<!doctype html><html><head><title>History A</title></head><body><h1>History A</h1><a href="/history-b">History B</a></body></html>`;
const HISTORY_B_HTML = `<!doctype html><html><head><title>History B</title></head><body><h1>History B</h1></body></html>`;
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
const UNKNOWN_INTERSTITIAL_HTML = `<!doctype html><html><head><title>Challenge</title></head><body>
  <canvas data-rendered-content="${"x".repeat(300)}"></canvas>
</body></html>`;
const SERVER_ERROR_HTML = `<!doctype html><html><head><title>Service unavailable</title></head><body>
  <h1>Service unavailable</h1>
</body></html>`;
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

/**
 * Tiny deterministic fixture server for tests and manual demos.
 * Binds to 127.0.0.1 on an ephemeral port and serves the inspection fixture.
 */
export async function startFixtureServer(): Promise<FixtureServer> {
  const inspectionHtml = await readFile(INSPECTION_HTML_URL, "utf8");
  const server = createServer((request, response) => {
    if (request.url === "/download.txt") {
      response.writeHead(200, {
        "content-disposition": 'attachment; filename="rove-session-download.txt"',
        "content-type": "text/plain; charset=utf-8",
      });
      response.end("rove session download");
      return;
    }

    const fixture: string | { body: string; status: number } = {
      "/": inspectionHtml,
      "/popup": POPUP_HTML,
      "/actions": ACTIONS_HTML,
      "/result": RESULT_HTML,
      "/download": DOWNLOAD_HTML,
      "/history-a": HISTORY_A_HTML,
      "/history-b": HISTORY_B_HTML,
      "/popup-target": POPUP_TARGET_HTML,
      "/handoff": HANDOFF_HTML,
      "/access-restricted": ACCESS_RESTRICTED_HTML,
      "/human-verification": HUMAN_VERIFICATION_HTML,
      "/captcha-frame": "<!doctype html><html><body>hCaptcha</body></html>",
      "/authentication": AUTHENTICATION_HTML,
      "/unknown-interstitial": UNKNOWN_INTERSTITIAL_HTML,
      "/server-error": { body: SERVER_ERROR_HTML, status: 503 },
      "/dynamic-target": DYNAMIC_TARGET_HTML,
    }[request.url ?? "/"] ?? inspectionHtml;
    response.writeHead(typeof fixture === "string" ? 200 : fixture.status, { "content-type": "text/html; charset=utf-8" });
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
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
