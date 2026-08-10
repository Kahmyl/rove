import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import {
  clickRequestSchema,
  inspectOptionsSchema,
  navigateRequestSchema,
  pressRequestSchema,
  screenshotRequestSchema,
  scrollRequestSchema,
  type ClickRequest,
  type InspectOptions,
  type NavigateRequest,
  type PressRequest,
  type ScreenshotOptions,
  type ScrollOptions,
  type TypeRequest,
  typeRequestSchema,
} from "@rove/protocol";
import { RuntimeService } from "../runtime.service.js";

@Controller("sessions/:id/browser")
export class BrowserController {
  constructor(private readonly runtime: RuntimeService) {}

  @Get("inspect")
  inspect(@Param("id") id: string, @Query() query: Record<string, string | undefined>) {
    const options: InspectOptions = inspectOptionsSchema.parse({
      pageId: query.pageId,
      includeText: parseBoolean(query.includeText),
      includeTargets: parseBoolean(query.includeTargets),
      maxTextChars: parseNumber(query.maxTextChars),
      targetLimit: parseNumber(query.targetLimit),
    });
    return this.runtime.inspectBrowser(id, options);
  }

  @Post("navigate")
  navigate(@Param("id") id: string, @Body() request: NavigateRequest) {
    return this.runtime.navigate(id, navigateRequestSchema.parse(request));
  }

  @Post("click")
  click(@Param("id") id: string, @Body() request: ClickRequest) {
    return this.runtime.click(id, clickRequestSchema.parse(request));
  }

  @Post("type")
  type(@Param("id") id: string, @Body() request: TypeRequest) {
    return this.runtime.type(id, typeRequestSchema.parse(request));
  }

  @Post("press")
  press(@Param("id") id: string, @Body() request: PressRequest) {
    return this.runtime.press(id, pressRequestSchema.parse(request));
  }

  @Post("scroll")
  scroll(@Param("id") id: string, @Body() request: ScrollOptions) {
    return this.runtime.scroll(id, scrollRequestSchema.parse(request));
  }

  @Post("back")
  back(@Param("id") id: string) {
    return this.runtime.back(id);
  }

  @Post("forward")
  forward(@Param("id") id: string) {
    return this.runtime.forward(id);
  }

  @Post("screenshot")
  screenshot(@Param("id") id: string, @Body() request: ScreenshotOptions) {
    return this.runtime.screenshot(id, screenshotRequestSchema.parse(request ?? {}));
  }
}

function parseBoolean(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  return value === "true";
}

function parseNumber(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  return Number(value);
}
