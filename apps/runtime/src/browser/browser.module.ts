import { Module } from "@nestjs/common";
import { BROWSER_ENGINE, NotImplementedBrowserEngine } from "@rove/browser";
import { BrowserService } from "./browser.service.js";

@Module({
  providers: [
    BrowserService,
    { provide: BROWSER_ENGINE, useClass: NotImplementedBrowserEngine },
  ],
  exports: [BrowserService],
})
export class BrowserModule {}
