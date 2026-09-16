import { TypeList, type Class } from "@abp/core";

/** Port of `AbpConventionalControllerOptions` (the parts meaningful without reflection-based auto controllers). */
export class AbpConventionalControllerOptions {
  /** Set true to use the old style URL path style (camelCase instead of kebab-case). Default: false. */
  useV3UrlStyle = false;
  ignoredUrlSuffixesInControllerNames: string[] = ["Integration"];
}

/** Port of `AbpAspNetCoreMvcOptions`. */
export class AbpAspNetCoreMvcOptions {
  /** Controllers served by the host: added explicitly here or collected from DI registrations of `@Controller` classes. */
  readonly controllers = new TypeList<object>();
  readonly conventionalControllers = new AbpConventionalControllerOptions();
  readonly ignoredControllersOnModelExclusion = new Set<Class>();
  readonly controllersToRemove = new Set<Class>();
  exposeIntegrationServices = false;
  /** Validate bound action arguments (`ModelState`) automatically. Default: true. */
  autoModelValidation = true;
  changeControllerModelApiExplorerGroupName = true;
}
