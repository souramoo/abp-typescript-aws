import { AbpModule, DependsOn, type ServiceConfigurationContext } from "@abp/core";
import { AbpAspNetCoreMvcModule, Controller } from "@abp/aws-lambda";
import { AbpSwaggerController, normalizeRoutePrefix, swaggerControllerOptions } from "./abp-swagger-controller.js";
import { AbpSwaggerUIOptions } from "./abp-swagger-ui-options.js";
import "./openapi-document-generator.js";

/**
 * Port of `AbpSwashbuckleModule`. The virtual file system dependency is gone (UI assets come from the CDN);
 * importing this module registers `AbpSwaggerController` (collected by the MVC module like any `@Controller`) and
 * `OpenApiDocumentGenerator`. Configure `AbpSwaggerGenOptions` (documents, security) and `AbpSwaggerUIOptions`.
 */
@DependsOn(AbpAspNetCoreMvcModule)
export class AbpSwashbuckleModule extends AbpModule {
  override postConfigureServices(context: ServiceConfigurationContext): void {
    const prefix = normalizeRoutePrefix(context.services.options.build(AbpSwaggerUIOptions).routePrefix);
    if (prefix !== "swagger") Controller(prefix, swaggerControllerOptions)(AbpSwaggerController);
  }
}
