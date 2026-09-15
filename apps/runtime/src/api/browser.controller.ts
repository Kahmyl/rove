import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Post,
  Query,
  Res,
} from "@nestjs/common";
import {
  browserRecoveryAdmissionRequestSchema,
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
  targetResolutionRequestSchema,
  verifiedInteractionRequestSchema,
  advanceSemanticTransactionRequestSchema,
  beginSemanticTransactionRequestSchema,
  semanticTransactionReferenceSchema,
  verifySemanticTransactionRequestSchema,
  type AdvanceSemanticTransactionRequest,
  type BeginSemanticTransactionRequest,
  type TargetResolutionRequest,
  type VerifiedInteractionRequest,
  type VerifySemanticTransactionRequest,
  type BrowserRecoveryAdmissionRequest,
} from "@rove/protocol";
import { RuntimeService } from "../runtime.service.js";

@Controller("sessions/:id/browser")
export class BrowserController {
  constructor(
    @Inject(RuntimeService) private readonly runtime: RuntimeService,
  ) {}

  @Post("recovery-admissions")
  admitRecovery(
    @Param("id") id: string,
    @Body() body: BrowserRecoveryAdmissionRequest,
  ) {
    return this.runtime.admitBrowserRecovery(
      id,
      browserRecoveryAdmissionRequestSchema.parse(body),
    );
  }

  @Get("host")
  host(@Param("id") id: string) {
    return this.runtime.getBrowserHostIdentity(id);
  }

  @Get("window")
  window(@Param("id") id: string) {
    return this.runtime.getBrowserWindowState(id);
  }

  @Post("show")
  show(@Param("id") id: string) {
    return this.runtime.showBrowser(id);
  }

  @Post("navigate")
  navigate(@Param("id") id: string, @Body() body: NavigateRequest) {
    return this.runtime.navigate(id, navigateRequestSchema.parse(body));
  }

  @Post("pages")
  openPage(@Param("id") id: string, @Body() body: NavigateRequest) {
    return this.runtime.openPage(id, navigateRequestSchema.parse(body));
  }

  @Get("inspect")
  inspectGet(
    @Param("id") id: string,
    @Query() query: Record<string, string | undefined>,
    @Res({ passthrough: true }) response: InspectResponse,
  ) {
    return this.inspectWithDisconnectFence(
      response,
      id,
      inspectOptionsSchema.parse({
        pageId: query.pageId,
        includeText: parseBoolean(query.includeText),
        includeTargets: parseBoolean(query.includeTargets),
        includeViewport: parseBoolean(query.includeViewport),
        includeStructure: parseBoolean(query.includeStructure),
        maxTextChars: parseNumber(query.maxTextChars),
        maxStructureChars: parseNumber(query.maxStructureChars),
        targetLimit: parseNumber(query.targetLimit),
      }),
    );
  }

  @Post("inspect")
  inspectPost(
    @Param("id") id: string,
    @Body() body: InspectOptions = {},
    @Res({ passthrough: true }) response: InspectResponse,
  ) {
    return this.inspectWithDisconnectFence(
      response,
      id,
      inspectOptionsSchema.parse(body),
    );
  }

  private async inspectWithDisconnectFence(
    response: InspectResponse,
    sessionId: string,
    options: InspectOptions,
  ) {
    const abort = new AbortController();
    const onClose = () => {
      if (!response.writableEnded) abort.abort();
    };
    response.once("close", onClose);
    try {
      return await this.runtime.inspectBrowser(
        sessionId,
        options,
        abort.signal,
      );
    } finally {
      response.off("close", onClose);
    }
  }

  @Post("resolve-target")
  resolveTarget(
    @Param("id") id: string,
    @Body() body: TargetResolutionRequest,
  ) {
    return this.runtime.resolveBrowserTarget(
      id,
      targetResolutionRequestSchema.parse(body),
    );
  }

  @Post("interact")
  interact(@Param("id") id: string, @Body() body: VerifiedInteractionRequest) {
    return this.runtime.interact(
      id,
      verifiedInteractionRequestSchema.parse(body),
    );
  }

  @Post("transactions")
  beginTransaction(
    @Param("id") id: string,
    @Body() body: BeginSemanticTransactionRequest,
  ) {
    return this.runtime.beginSemanticTransaction(
      id,
      beginSemanticTransactionRequestSchema.parse(body),
    );
  }

  @Post("transactions/:transactionId/advance")
  advanceTransaction(
    @Param("id") id: string,
    @Param("transactionId") transactionId: string,
    @Body() body: Omit<AdvanceSemanticTransactionRequest, "transactionId">,
  ) {
    return this.runtime.advanceSemanticTransaction(
      id,
      advanceSemanticTransactionRequestSchema.parse({
        ...body,
        transactionId,
      }),
    );
  }

  @Post("transactions/:transactionId/verify")
  verifyTransaction(
    @Param("id") id: string,
    @Param("transactionId") transactionId: string,
    @Body() body: Omit<VerifySemanticTransactionRequest, "transactionId">,
  ) {
    return this.runtime.verifySemanticTransaction(
      id,
      verifySemanticTransactionRequestSchema.parse({
        ...body,
        transactionId,
      }),
    );
  }

  @Get("transactions/:transactionId")
  getTransaction(
    @Param("id") id: string,
    @Param("transactionId") transactionId: string,
  ) {
    return this.runtime.getSemanticTransaction(
      id,
      semanticTransactionReferenceSchema.parse({ transactionId }).transactionId,
    );
  }

  @Post("transactions/:transactionId/cancel")
  cancelTransaction(
    @Param("id") id: string,
    @Param("transactionId") transactionId: string,
  ) {
    return this.runtime.cancelSemanticTransaction(
      id,
      semanticTransactionReferenceSchema.parse({ transactionId }).transactionId,
    );
  }

  @Post("click")
  click(@Param("id") id: string, @Body() body: ClickRequest) {
    return this.runtime.click(id, clickRequestSchema.parse(body));
  }

  @Post("type")
  type(@Param("id") id: string, @Body() body: TypeRequest) {
    return this.runtime.type(id, typeRequestSchema.parse(body));
  }

  @Post("press")
  press(@Param("id") id: string, @Body() body: PressRequest) {
    return this.runtime.press(id, pressRequestSchema.parse(body));
  }

  @Post("scroll")
  scroll(@Param("id") id: string, @Body() body: ScrollOptions) {
    return this.runtime.scroll(id, scrollOptionsSchema.parse(body));
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
  screenshot(@Param("id") id: string, @Body() body: ScreenshotOptions = {}) {
    return this.runtime.captureScreenshot(
      id,
      screenshotOptionsSchema.parse(body),
    );
  }

  @Get("pages")
  pages(@Param("id") id: string) {
    return this.runtime.pages(id);
  }

  @Post("pages/:pageId/switch")
  switchPage(@Param("id") id: string, @Param("pageId") pageId: string) {
    return this.runtime.switchPage(id, pageId);
  }

  @Delete("pages/:pageId")
  closePage(@Param("id") id: string, @Param("pageId") pageId: string) {
    return this.runtime.closePage(id, pageId);
  }
}

interface InspectResponse {
  writableEnded: boolean;
  once(event: "close", listener: () => void): void;
  off(event: "close", listener: () => void): void;
}

function parseBoolean(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  return value === "true";
}

function parseNumber(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  return Number(value);
}
