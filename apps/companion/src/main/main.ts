import { app, BrowserWindow, ipcMain } from "electron";
import { join } from "node:path";

function createWindow(): void {
  const window = new BrowserWindow({
    width: 420,
    height: 620,
    minWidth: 360,
    minHeight: 480,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: join(import.meta.dirname, "../preload/preload.js"),
    },
  });

  const developmentUrl = process.env.ROVE_COMPANION_DEV_URL;
  if (developmentUrl) void window.loadURL(developmentUrl);
  else void window.loadFile(join(import.meta.dirname, "../renderer/index.html"));
}

app.whenReady().then(() => {
  ipcMain.handle("rove:session", async () => null);
  ipcMain.handle("rove:take-control", async () => undefined);
  ipcMain.handle("rove:return-control", async () => undefined);
  ipcMain.handle("rove:finish", async () => undefined);
  createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
