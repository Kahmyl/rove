import { readFile } from "node:fs/promises";
import { createServer } from "node:http";

export interface FixtureServer {
  readonly port: number;
  readonly url: string;
  close(): Promise<void>;
}

const INSPECTION_HTML_URL = new URL("./pages/inspection.html", import.meta.url);

const POPUP_HTML = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Rove Popup Fixture</title></head>
  <body>
    <p>Popup opener</p>
    <script>window.open("/", "_blank");</script>
  </body>
</html>
`;

/**
 * Tiny deterministic fixture server for tests and manual demos.
 * Binds to 127.0.0.1 on an ephemeral port and serves the inspection fixture.
 */
export async function startFixtureServer(): Promise<FixtureServer> {
  const inspectionHtml = await readFile(INSPECTION_HTML_URL, "utf8");
  const server = createServer((request, response) => {
    const body = request.url === "/popup" ? POPUP_HTML : inspectionHtml;
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(body);
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
