import { Module } from "@nestjs/common";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import { BROWSER_ENGINE, PlaywrightBrowserEngine } from "@rove/browser";
import { loadConfig } from "@rove/config";
import { ROVE_RUNTIME } from "@rove/protocol";
import { FileEvidenceStore, FileObservationStore, FileSessionStore } from "@rove/storage";
import { BrowserController } from "./api/browser.controller.js";
import { ControlController } from "./api/control.controller.js";
import { EvidenceController } from "./api/evidence.controller.js";
import { HealthController } from "./api/health.controller.js";
import { ObservationController } from "./api/observation.controller.js";
import { RoveErrorFilter } from "./api/rove-error.filter.js";
import { RuntimeAuthGuard, assertRuntimeBindingSafe } from "./api/runtime-auth.guard.js";
import { SessionController } from "./api/session.controller.js";
import { BrowserService } from "./browser/browser.service.js";
import { BrowserCommandCoordinator } from "./control/command-coordinator.js";
import { ControlService } from "./control/control.service.js";
import { ControlWaitService } from "./control/control-wait.service.js";
import { EvidenceService } from "./evidence/evidence.service.js";
import { ObservationService } from "./observation/observation.service.js";
import { RuntimeService } from "./runtime.service.js";
import { SessionService } from "./session/session.service.js";
import { EVIDENCE_STORE, OBSERVATION_STORE, ROVE_CONFIG, SESSION_STORE } from "./tokens.js";

const config = loadConfig();
assertRuntimeBindingSafe(config);

@Module({
  controllers: [
    HealthController,
    SessionController,
    BrowserController,
    ControlController,
    ObservationController,
    EvidenceController,
  ],
  providers: [
    { provide: SESSION_STORE, useValue: new FileSessionStore(config.home) },
    { provide: OBSERVATION_STORE, useValue: new FileObservationStore(config.home) },
    { provide: EVIDENCE_STORE, useValue: new FileEvidenceStore(config.home) },
    { provide: ROVE_CONFIG, useValue: config },
    { provide: BROWSER_ENGINE, useClass: PlaywrightBrowserEngine },
    { provide: APP_GUARD, useClass: RuntimeAuthGuard },
    { provide: APP_FILTER, useClass: RoveErrorFilter },
    SessionService,
    ControlService,
    ControlWaitService,
    BrowserCommandCoordinator,
    BrowserService,
    ObservationService,
    EvidenceService,
    RuntimeService,
    { provide: ROVE_RUNTIME, useExisting: RuntimeService },
  ],
  exports: [RuntimeService, ROVE_RUNTIME],
})
export class AppModule {}
