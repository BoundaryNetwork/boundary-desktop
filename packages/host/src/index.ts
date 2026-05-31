export { Registry } from "./registry.js";
export type {
  ArtifactSource,
  CapabilityHost,
  ModuleCapabilities,
  ModuleSnapshot,
  RegistryOptions,
  SurfaceProvider,
} from "./registry.js";
export type { ToolInfo } from "./tool-registry.js";

export { LocalDirSource, RemoteSource, entryToLocalPath, verifyIntegrity } from "./sources.js";
export type { Catalog, ModuleSource, RemoteSourceOptions } from "./sources.js";

export { Reconciler } from "./reconcile.js";
export type { ReconcileReport } from "./reconcile.js";

export { StateContainer } from "./state-container.js";
export type { TrackDisposable } from "./state-container.js";

export { HostServices } from "./capabilities.js";
export type {
  ApiDriver,
  AuthDriver,
  HostServicesOptions,
  Logger,
  NotificationSink,
  StorageBackend,
} from "./capabilities.js";

export { MainLoader } from "./main-loader.js";

export type { ToolFacade } from "./facade.js";
export { startWsFacade } from "./ws-facade.js";
export type { WsFacadeHandle } from "./ws-facade.js";

export { HOST_API_VERSION } from "@boundary-desktop/contract";
