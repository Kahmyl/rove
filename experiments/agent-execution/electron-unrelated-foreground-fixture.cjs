/* eslint-disable @typescript-eslint/no-require-imports */
/* global require */

const { app, BrowserWindow } = require("electron");

void app.whenReady().then(() => {
  const window = new BrowserWindow({
    width: 520,
    height: 360,
    show: true,
    title: "Unrelated local qualification window",
  });
  void window.loadURL(
    "data:text/html,<title>Unrelated local qualification window</title><main><h1>Unrelated local application</h1></main>",
  );
});

app.on("window-all-closed", () => app.quit());
