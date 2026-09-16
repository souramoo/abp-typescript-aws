import { AbpModule, DependsOn, type Class, type ServiceCollection, type ServiceConfigurationContext } from "@abp/core";
import { AbpAuditingModule, AbpAuditingOptions } from "@abp/auditing";
import { AbpAuthorizationModule } from "@abp/authorization";
import { AbpFeaturesModule } from "@abp/features";
import { AbpGlobalFeaturesModule } from "@abp/global-features";
import { AbpHttpModule } from "@abp/http";
import { AbpJsonModule } from "@abp/json";
import { AbpLocalizationModule } from "@abp/localization";
import { AbpMultiTenancyModule } from "@abp/multi-tenancy";
import { AbpMultiTenancyAbstractionsModule, AbpTenantResolveOptions } from "@abp/multi-tenancy-abstractions";
import { AbpSecurityModule } from "@abp/security";
import { AbpSettingsModule } from "@abp/settings";
import { AbpTimingModule } from "@abp/timing";
import { AbpUnitOfWorkModule } from "@abp/uow";
import { AbpValidationModule } from "@abp/validation";
import { AbpAuditingMiddleware, AspNetCoreAuditLogContributor } from "./middleware/auditing.js";
import { AbpAuthenticationMiddleware, AbpAuthenticationOptions, AnonymousAuthenticationHandler } from "./middleware/authentication.js";
import { AbpCorrelationIdMiddleware } from "./middleware/correlation-id.js";
import { AbpExceptionHandlingMiddleware } from "./middleware/exception-handling.js";
import { CookieTenantResolveContributor, HeaderTenantResolveContributor, MultiTenancyMiddleware, QueryStringTenantResolveContributor, RouteTenantResolveContributor } from "./middleware/multi-tenancy.js";
import { AbpMiddlewareNames, AbpRequestPipelineOptions } from "./middleware/pipeline.js";
import { AbpRequestLocalizationMiddleware } from "./middleware/request-localization.js";
import { AbpUnitOfWorkMiddleware } from "./middleware/unit-of-work.js";
import { AbpAspNetCoreMvcOptions } from "./mvc/abp-aspnetcore-mvc-options.js";
import { isController } from "./mvc/controller.js";
import { AbpEndpointMiddleware, AbpRoutingMiddleware } from "./mvc/mvc-middleware.js";
import { IWebClientInfoProvider, NullWebClientInfoProvider } from "./web-client-info.js";
import "./http-context.js";
import "./middleware/exception-handling.js";
import "./middleware/multi-tenancy.js";
import "./middleware/unit-of-work.js";
import "./mvc/api-description-model-provider.js";
import "./mvc/application-configurations/app-services.js";
import "./mvc/application-configurations/controllers.js";
import "./web-client-info.js";

/** Port of `AbpAspNetCoreAbstractionsModule`. */
export class AbpAspNetCoreAbstractionsModule extends AbpModule {
  override configureServices(context: ServiceConfigurationContext): void {
    context.services.tryAddSingleton(IWebClientInfoProvider, { useValue: NullWebClientInfoProvider.instance });
  }
}

/**
 * Port of `AbpAspNetCoreModule` (no virtual file system / static files). Configures the default pipeline order of
 * the ABP startup template: correlation id → exception handling → request localization → authentication →
 * auditing → unit of work; the MVC and multi-tenancy modules insert routing/endpoints and tenant resolution.
 */
@DependsOn(AbpAuditingModule, AbpSecurityModule, AbpUnitOfWorkModule, AbpHttpModule, AbpAuthorizationModule, AbpValidationModule, AbpAspNetCoreAbstractionsModule)
export class AbpAspNetCoreModule extends AbpModule {
  override configureServices(): void {
    this.configure(AbpAuditingOptions, (options) => {
      options.contributors.push(new AspNetCoreAuditLogContributor());
    });

    this.configure(AbpAuthenticationOptions, (options) => {
      if (options.schemes.length === 0) options.addScheme(AnonymousAuthenticationHandler.SchemeName, AnonymousAuthenticationHandler);
    });

    this.configure(AbpRequestPipelineOptions, (options) => {
      options.middlewares
        .add(AbpMiddlewareNames.CorrelationId, AbpCorrelationIdMiddleware)
        .add(AbpMiddlewareNames.ExceptionHandling, AbpExceptionHandlingMiddleware)
        .add(AbpMiddlewareNames.RequestLocalization, AbpRequestLocalizationMiddleware)
        .add(AbpMiddlewareNames.Authentication, AbpAuthenticationMiddleware)
        .add(AbpMiddlewareNames.Auditing, AbpAuditingMiddleware)
        .add(AbpMiddlewareNames.UnitOfWork, AbpUnitOfWorkMiddleware);
    });
  }

  override postConfigureServices(): void {
    this.configure(AbpAuthenticationOptions, (options) => {
      const anonymous = options.schemes.findIndex((s) => s.handlerType === AnonymousAuthenticationHandler);
      if (anonymous >= 0 && options.schemes.length > 1) options.schemes.push(...options.schemes.splice(anonymous, 1));
    });
  }
}

/** Port of `AbpAspNetCoreMvcContractsModule` (the DDD application contracts dependency is not needed here). */
@DependsOn(AbpMultiTenancyAbstractionsModule)
export class AbpAspNetCoreMvcContractsModule extends AbpModule {}

/**
 * Port of `AbpAspNetCoreMvcModule`. `@Controller` classes registered in DI are collected as controllers (port of
 * `AbpConventionalControllerFeatureProvider`) and the routing/endpoint middlewares are appended to the pipeline.
 */
@DependsOn(AbpAspNetCoreModule, AbpLocalizationModule, AbpAspNetCoreMvcContractsModule, AbpGlobalFeaturesModule, AbpFeaturesModule, AbpSettingsModule, AbpTimingModule, AbpJsonModule)
export class AbpAspNetCoreMvcModule extends AbpModule {
  override preConfigureServices(context: ServiceConfigurationContext): void {
    collectControllers(context.services);
  }

  override configureServices(): void {
    this.configure(AbpRequestPipelineOptions, (options) => {
      if (options.middlewares.contains(AbpMiddlewareNames.Authentication)) options.middlewares.insertAfter(AbpMiddlewareNames.Authentication, AbpMiddlewareNames.Routing, AbpRoutingMiddleware);
      else options.middlewares.add(AbpMiddlewareNames.Routing, AbpRoutingMiddleware);
      options.middlewares.add(AbpMiddlewareNames.Endpoints, AbpEndpointMiddleware);
    });
  }

  override postConfigureServices(context: ServiceConfigurationContext): void {
    const options = context.services.options.build(AbpAspNetCoreMvcOptions);
    for (const controller of options.controllers) {
      if (!context.services.isRegistered(controller)) context.services.addTransient(controller);
    }
  }
}

function collectControllers(services: ServiceCollection): void {
  const controllers: Class[] = [];
  services.onRegistered((ctx) => {
    if (isController(ctx.implementationType) && !controllers.includes(ctx.implementationType)) controllers.push(ctx.implementationType);
  });
  services.options.configure(AbpAspNetCoreMvcOptions, (options) => {
    for (const controller of controllers) options.controllers.add(controller);
  });
}

/**
 * Port of `AbpAspNetCoreMultiTenancyModule`: adds the HTTP tenant resolvers in .NET order (after the current-user
 * resolver: query string, route, header, cookie) and the tenant middleware after authentication.
 */
@DependsOn(AbpMultiTenancyModule, AbpAspNetCoreModule)
export class AbpAspNetCoreMultiTenancyModule extends AbpModule {
  override configureServices(): void {
    this.configure(AbpTenantResolveOptions, (options) => {
      options.tenantResolvers.push(new QueryStringTenantResolveContributor(), new RouteTenantResolveContributor(), new HeaderTenantResolveContributor(), new CookieTenantResolveContributor());
    });

    this.configure(AbpRequestPipelineOptions, (options) => {
      const anchor = options.middlewares.contains(AbpMiddlewareNames.Routing) ? AbpMiddlewareNames.Routing : AbpMiddlewareNames.Authentication;
      options.middlewares.insertAfter(anchor, AbpMiddlewareNames.MultiTenancy, MultiTenancyMiddleware);
    });
  }
}
