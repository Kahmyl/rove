import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
} from "@nestjs/common";
import {
  browserWorkspaceIdSchema,
  createBrowserWorkspaceRequestSchema,
  renameBrowserWorkspaceRequestSchema,
} from "@rove/protocol";

import { RuntimeService } from "../runtime.service.js";

@Controller("browser-workspaces")
export class BrowserWorkspaceController {
  constructor(
    @Inject(RuntimeService)
    private readonly runtime: RuntimeService,
  ) {}

  @Get()
  status() {
    return this.runtime.listBrowserWorkspaces();
  }

  @Post()
  create(@Body() request: unknown) {
    const { displayName } = createBrowserWorkspaceRequestSchema.parse(request);
    return this.runtime.createBrowserWorkspace(displayName);
  }

  @Post(":id/select")
  select(@Param("id") id: string) {
    return this.runtime.selectBrowserWorkspace(
      browserWorkspaceIdSchema.parse(id),
    );
  }

  @Patch(":id")
  rename(@Param("id") id: string, @Body() request: unknown) {
    const { displayName } = renameBrowserWorkspaceRequestSchema.parse(request);
    return this.runtime.renameBrowserWorkspace(
      browserWorkspaceIdSchema.parse(id),
      displayName,
    );
  }

  @Delete(":id")
  delete(@Param("id") id: string) {
    return this.runtime.deleteBrowserWorkspace(
      browserWorkspaceIdSchema.parse(id),
    );
  }
}
