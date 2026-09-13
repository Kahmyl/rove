import { Module } from "@nestjs/common";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import { BROWSER_ENGINE, PlaywrightBrowserEngine } from "@rove/browser";
import { loadConfig } from "@rove/config";
import { ROVE_RUNTIME } from "@rove/protocol";
import {
  FileEvidenceStore,
  FileEffectJournalStore,
  FileObservationStore,
  FileRecordingStore,
  FileSessionStore,
} from "@rove/storage";
import { BrowserController } from "./api/browser.controller.js";
import { BrowserWorkspaceController } from "./api/browser-workspace.controller.js";
import { ControlController } from "./api/control.controller.js";
import { EvidenceController } from "./api/evidence.controller.js";
import { HealthController } from "./api/health.controller.js";
import { ObservationController } from "./api/observation.controller.js";
import { RecordingController } from "./api/recording.controller.js";
import { RoveErrorFilter } from "./api/rove-error.filter.js";
import {
  RuntimeAuthGuard,
  assertRuntimeBindingSafe,
} from "./api/runtime-auth.guard.js";
import { SessionController } from "./api/session.controller.js";
import { BrowserService } from "./browser/browser.service.js";
import { BrowserCommandCoordinator } from "./control/command-coordinator.js";
import { BrowserOwnershipFence } from "./control/browser-ownership-fence.js";
import { ControlService } from "./control/control.service.js";
import { ControlWaitService } from "./control/control-wait.service.js";
import { EvidenceService } from "./evidence/evidence.service.js";
import { ObservationService } from "./observation/observation.service.js";
import { RuntimeService } from "./runtime.service.js";
import { RecordingService } from "./recording/recording.service.js";
import { SessionService } from "./session/session.service.js";
import {
  EVIDENCE_STORE,
  EFFECT_JOURNAL_STORE,
  OBSERVATION_STORE,
  ROVE_CONFIG,
  RECORDING_STORE,
  SESSION_STORE,
} from "./tokens.js";

const config = loadConfig();
assertRuntimeBindingSafe(config);

@Module({
  controllers: [
    HealthController,
    SessionController,
    BrowserController,
    BrowserWorkspaceController,
    ControlController,
    ObservationController,
    EvidenceController,
    RecordingController,
  ],
  providers: [
    { provide: SESSION_STORE, useValue: new FileSessionStore(config.home) },
    {
      provide: OBSERVATION_STORE,
      useValue: new FileObservationStore(config.home),
    },
    { provide: EVIDENCE_STORE, useValue: new FileEvidenceStore(config.home) },
    { provide: RECORDING_STORE, useValue: new FileRecordingStore(config.home) },
    {
      provide: EFFECT_JOURNAL_STORE,
      useValue: new FileEffectJournalStore(config.home),
    },
    { provide: ROVE_CONFIG, useValue: config },
    { provide: BROWSER_ENGINE, useClass: PlaywrightBrowserEngine },
    { provide: APP_GUARD, useClass: RuntimeAuthGuard },
    { provide: APP_FILTER, useClass: RoveErrorFilter },
    SessionService,
    ControlService,
    ControlWaitService,
    BrowserCommandCoordinator,
    BrowserOwnershipFence,
    BrowserService,
    ObservationService,
    EvidenceService,
    RecordingService,
    RuntimeService,
    { provide: ROVE_RUNTIME, useExisting: RuntimeService },
  ],
  exports: [RuntimeService, ROVE_RUNTIME],
})
export class AppModule {}
