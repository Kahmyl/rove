import { describe, expect, it } from "vitest";

import { createElectronBrowserFollowDisplaySource } from "./electron-browser-follow-display-source.js";

describe("createElectronBrowserFollowDisplaySource", () => {
  it("maps Electron display bounds and work areas without changing coordinate values", () => {
    const source = createElectronBrowserFollowDisplaySource({
      getAllDisplays: () => [
        {
          id: 11,
          bounds: {
            x: -1440,
            y: 0,
            width: 1440,
            height: 900,
          },
          workArea: {
            x: -1440,
            y: 24,
            width: 1440,
            height: 876,
          },
        },
        {
          id: 22,
          bounds: {
            x: 0,
            y: 0,
            width: 1920,
            height: 1080,
          },
          workArea: {
            x: 0,
            y: 24,
            width: 1920,
            height: 1056,
          },
        },
      ],
    });

    expect(source.getAllDisplays()).toEqual([
      {
        id: 11,
        bounds: {
          x: -1440,
          y: 0,
          width: 1440,
          height: 900,
        },
        workArea: {
          x: -1440,
          y: 24,
          width: 1440,
          height: 876,
        },
      },
      {
        id: 22,
        bounds: {
          x: 0,
          y: 0,
          width: 1920,
          height: 1080,
        },
        workArea: {
          x: 0,
          y: 24,
          width: 1920,
          height: 1056,
        },
      },
    ]);
  });

  it("reads display topology live on every controller reconciliation", () => {
    let displays = [
      {
        id: 1,
        bounds: {
          x: 0,
          y: 0,
          width: 1200,
          height: 800,
        },
        workArea: {
          x: 0,
          y: 0,
          width: 1200,
          height: 760,
        },
      },
    ];

    const source = createElectronBrowserFollowDisplaySource({
      getAllDisplays: () => displays,
    });

    expect(source.getAllDisplays()).toHaveLength(1);

    displays = [
      ...displays,
      {
        id: 2,
        bounds: {
          x: 1200,
          y: 0,
          width: 1200,
          height: 800,
        },
        workArea: {
          x: 1200,
          y: 0,
          width: 1200,
          height: 760,
        },
      },
    ];

    expect(source.getAllDisplays()).toHaveLength(2);

    expect(source.getAllDisplays()[1]).toMatchObject({
      id: 2,
      bounds: {
        x: 1200,
      },
    });
  });
});
