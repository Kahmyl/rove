import { Module } from "@nestjs/common";
import { NotImplementedBrowserEngine, BROWSER_ENGINE } from "@rove/browser";
import { loadConfig } from "@rove/config";
import { ROVE_RUNTIME } from "@rove/protocol";
import { FileEvidenceStore, FileObservationStore, FileSessionStore } from "@rove/storage";
import { HealthController } from "./api/health.controller.js";
import { BrowserController } from "./api/browser.controller.js";
import { ControlController } from "./api/control.controller.js";
import { EvidenceController } from "./api/evidence.controller.js";
import { SessionController } from "./api/session.controller.js";
import { BrowserService } from "./browser/browser.service.js";
import { BrowserCommandCoordinator } from "./control/command-coordinator.js";
import { ControlService } from "./control/control.service.js";
import { EvidenceService } from "./evidence/evidence.service.js";
import { ObservationService } from "./observation/observation.service.js";
import { RuntimeService } from "./runtime.service.js";
import { SessionService } from "./session/session.service.js";
import { EVIDENCE_STORE, OBSERVATION_STORE, SESSION_STORE } from "./tokens.js";

const config = loadConfig();

@Module({
  controllers: [HealthController, SessionController, BrowserController, ControlController, EvidenceController],
  providers: [
    { provide: SESSION_STORE, useValue: new FileSessionStore(config.home) },
    { provide: OBSERVATION_STORE, useValue: new FileObservationStore(config.home) },
    { provide: EVIDENCE_STORE, useValue: new FileEvidenceStore(config.home) },
    { provide: BROWSER_ENGINE, useClass: NotImplementedBrowserEngine },
    SessionService,
    ControlService,
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
