import type { Class } from "@abp/core";

/** Port of `AbpExceptionLocalizationOptions`: maps error code namespaces (`"Volo.Abp"` in `"Volo.Abp:010001"`) to resources. */
export class AbpExceptionLocalizationOptions {
  readonly errorCodeNamespaceMappings = new Map<string, Class>();

  mapCodeNamespace(errorCodeNamespace: string, resourceType: Class): void {
    this.errorCodeNamespaceMappings.set(errorCodeNamespace, resourceType);
  }
}
