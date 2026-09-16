import { createToken } from "./dependency-injection/service-token.js";
import type { Guid } from "./text/guid.js";

/** Port of `ISoftDelete`. */
export interface ISoftDelete {
  isDeleted: boolean;
}
/** Port of `NameValue<T>`. */
export interface NameValue<T = string> {
  name: string;
  value: T;
}
/** Port of `IKeyedObject`. */
export interface IKeyedObject {
  readonly key: string;
}
/** Port of `IRemoteService` marker: application services exposed over HTTP. */
export interface IRemoteService {
  readonly __remoteService?: true;
}

/** Port of `RemoteServiceAttribute`: metadata for auto API controllers & client proxies. */
export interface RemoteServiceMetadata {
  name?: string;
  isEnabled?: boolean;
  isMetadataEnabled?: boolean;
}
const remoteServiceMetadata = new WeakMap<object, RemoteServiceMetadata>();
export function RemoteService(metadata: RemoteServiceMetadata = {}) {
  return (target: object): void => {
    remoteServiceMetadata.set(target, { isEnabled: true, isMetadataEnabled: true, ...metadata });
  };
}
export function getRemoteServiceMetadata(target: object): RemoteServiceMetadata | undefined {
  return remoteServiceMetadata.get(target);
}
/** Port of `IntegrationServiceAttribute`. */
export function IntegrationService() {
  return RemoteService({ name: "integration", isMetadataEnabled: false });
}

/** Port of `IAbpLazyServiceProvider` consumers: `ICurrentTenant` etc. use ambient keys. */
export const AbpAmbientKeys = {
  currentTenant: "Abp.MultiTenancy.CurrentTenant",
  currentPrincipal: "Abp.Security.CurrentPrincipal",
  unitOfWork: "Abp.Uow.Current",
  auditLogScope: "Abp.Auditing.Scope",
  dataFilter: (name: string) => `Abp.Data.Filter.${name}`,
} as const;

export const IGuidGeneratorLite = createToken<{ create(): Guid }>("IGuidGeneratorLite");
