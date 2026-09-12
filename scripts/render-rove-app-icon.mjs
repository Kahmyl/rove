#!/usr/bin/env node
/* global Buffer, document, Image */

import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";

const repositoryRoot = resolve(import.meta.dirname, "..");
const requireBrowserDependency = createRequire(
  join(repositoryRoot, "packages/browser/package.json"),
);
const { chromium } = requireBrowserDependency("playwright");
const sourcePath = join(
  repositoryRoot,
  "apps/companion/resources/rove-app-icon-source.png",
);
const outputs = [
  {
    path: join(repositoryRoot, "apps/companion/resources/rove-app-icon.png"),
    size: 1024,
  },
  {
    path: join(
      repositoryRoot,
      "apps/companion/src/renderer/assets/rove-mark.png",
    ),
    size: 256,
  },
];
const source = await readFile(sourcePath);
const browser = await chromium.launch({ headless: true });

try {
  const page = await browser.newPage();
  for (const output of outputs) {
    const rendered = await page.evaluate(
      async ({ source, size }) => {
        const image = new Image();
        image.src = source;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) throw new Error("Canvas is unavailable.");
        context.drawImage(image, 0, 0, size, size);
        const pixels = context.getImageData(0, 0, size, size);
        for (let index = 3; index < pixels.data.length; index += 4) {
          const alpha = pixels.data[index];
          pixels.data[index] =
            alpha <= 96
              ? 0
              : Math.min(255, Math.round(((alpha - 96) * 255) / 159));
        }
        context.putImageData(pixels, 0, 0);
        return {
          corner: context.getImageData(0, 0, 1, 1).data[3],
          center: context.getImageData(size / 2, size / 2, 1, 1).data[3],
          png: canvas.toDataURL("image/png"),
        };
      },
      {
        source: `data:image/png;base64,${source.toString("base64")}`,
        size: output.size,
      },
    );
    if (rendered.corner !== 0 || rendered.center < 250)
      throw new Error(
        `Unexpected app-icon alpha: ${JSON.stringify({ corner: rendered.corner, center: rendered.center })}`,
      );
    await writeFile(
      output.path,
      Buffer.from(rendered.png.split(",", 2)[1], "base64"),
    );
  }
} finally {
  await browser.close();
}
