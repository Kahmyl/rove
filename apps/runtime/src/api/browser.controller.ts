import { Body, Controller, Delete, Get, Inject, Param, Post } from "@nestjs/common";
import {
  clickRequestSchema,
  inspectOptionsSchema,
  navigateRequestSchema,
  pressRequestSchema,
  screenshotOptionsSchema,
  scrollOptionsSchema,
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
  constructor(@Inject(RuntimeService) private readonly runtime: RuntimeService) {}

  @Post("navigate") navigate(@Param("id") id: string, @Body() body: NavigateRequest) { return this.runtime.navigate(id, navigateRequestSchema.parse(body)); }
  @Post("inspect") inspect(@Param("id") id: string, @Body() body: InspectOptions = {}) { return this.runtime.inspectBrowser(id, inspectOptionsSchema.parse(body)); }
  @Post("click") click(@Param("id") id: string, @Body() body: ClickRequest) { return this.runtime.click(id, clickRequestSchema.parse(body)); }
  @Post("type") type(@Param("id") id: string, @Body() body: TypeRequest) { return this.runtime.type(id, typeRequestSchema.parse(body)); }
  @Post("press") press(@Param("id") id: string, @Body() body: PressRequest) { return this.runtime.press(id, pressRequestSchema.parse(body)); }
  @Post("scroll") scroll(@Param("id") id: string, @Body() body: ScrollOptions) { return this.runtime.scroll(id, scrollOptionsSchema.parse(body)); }
  @Post("back") back(@Param("id") id: string) { return this.runtime.back(id); }
  @Post("forward") forward(@Param("id") id: string) { return this.runtime.forward(id); }
  @Post("screenshot") screenshot(@Param("id") id: string, @Body() body: ScreenshotOptions = {}) { return this.runtime.captureScreenshot(id, screenshotOptionsSchema.parse(body)); }
  @Get("pages") pages(@Param("id") id: string) { return this.runtime.pages(id); }
  @Post("pages/:pageId/switch") switchPage(@Param("id") id: string, @Param("pageId") pageId: string) { return this.runtime.switchPage(id, pageId); }
  @Delete("pages/:pageId") closePage(@Param("id") id: string, @Param("pageId") pageId: string) { return this.runtime.closePage(id, pageId); }
}
