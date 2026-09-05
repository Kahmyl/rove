import type { BrowserFollowDisplaySource } from "./browser-follow-controller.js";

export interface ElectronFollowRectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ElectronFollowDisplay {
  id: number;
  bounds: ElectronFollowRectangle;
  workArea: ElectronFollowRectangle;
}

export interface ElectronFollowScreen {
  getAllDisplays(): readonly ElectronFollowDisplay[];
}

function copyRectangle(rectangle: ElectronFollowRectangle) {
  return {
    x: rectangle.x,
    y: rectangle.y,
    width: rectangle.width,
    height: rectangle.height,
  };
}

export function createElectronBrowserFollowDisplaySource(
  electronScreen: ElectronFollowScreen,
): BrowserFollowDisplaySource {
  return {
    getAllDisplays() {
      return electronScreen.getAllDisplays().map((display) => ({
        id: display.id,
        bounds: copyRectangle(display.bounds),
        workArea: copyRectangle(display.workArea),
      }));
    },
  };
}
