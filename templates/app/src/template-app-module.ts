import { AbpModule, DependsOn } from "@abp/core";
import { AbpAccountApplicationModule } from "@abp/account/application";
import { AbpAccountHttpApiModule } from "@abp/account/http-api";
import { AbpAuditLoggingDomainModule } from "@abp/audit-logging/domain";
import { AbpAuditingOptions } from "@abp/auditing";
import { AbpAspNetCoreAuthenticationJwtBearerModule, AbpJwtClientOptions, OpenIddictConstants } from "@abp/auth-jwt";
import { AbpAspNetCoreMultiTenancyModule, AbpAspNetCoreMvcModule } from "@abp/aws-lambda";
import { AbpBackgroundJobsModule } from "@abp/background-jobs";
import { AbpBackgroundJobsDomainModule } from "@abp/background-jobs-store/domain";
import { AbpBackgroundWorkersModule } from "@abp/background-workers";
import { AbpBlobStoringModule } from "@abp/blob-storing";
import { AbpCachingModule, AbpDistributedCacheOptions } from "@abp/caching";
import { AbpDddApplicationModule } from "@abp/ddd-application";
import { AbpDistributedLockingModule } from "@abp/distributed-locking";
import { AbpEmailingModule } from "@abp/emailing";
import { AbpEventBusModule } from "@abp/event-bus";
import { AbpFeatureManagementApplicationModule } from "@abp/feature-management/application";
import { AbpFeatureManagementHttpApiModule } from "@abp/feature-management/http-api";
import { AbpIdentityApplicationModule } from "@abp/identity/application";
import { AbpIdentityAuthModule } from "@abp/identity/auth";
import { AbpIdentityHttpApiModule } from "@abp/identity/http-api";
import { AbpExceptionLocalizationOptions, AbpLocalizationOptions, LanguageInfo } from "@abp/localization";
import { AbpMultiTenancyOptions } from "@abp/multi-tenancy-abstractions";
import { AbpObjectMappingOptions } from "@abp/object-mapping";
import { AbpPermissionManagementApplicationModule } from "@abp/permission-management/application";
import { AbpPermissionManagementDomainIdentityModule, AbpPermissionManagementDomainOpenIddictModule } from "@abp/permission-management/domain";
import { AbpPermissionManagementHttpApiModule } from "@abp/permission-management/http-api";
import { AbpSettingManagementApplicationModule } from "@abp/setting-management/application";
import { AbpSettingManagementHttpApiModule } from "@abp/setting-management/http-api";
import { AbpSmsModule } from "@abp/sms";
import { AbpSwaggerGenOptions, AbpSwaggerUIOptions, AbpSwashbuckleModule } from "@abp/swashbuckle";
import { AbpTenantManagementApplicationModule } from "@abp/tenant-management/application";
import { AbpTenantManagementHttpApiModule } from "@abp/tenant-management/http-api";
import { AbpValidationResource } from "@abp/validation";
import { TemplateAppMappingProfile, TemplateAppResource, templateAppEn } from "./books/index.js";
import "./books/index.js";
import "./seeding/template-app-tenants-data-seed-contributor.js";

/** The OAuth client of the sample (`MyProjectName_App` in the .NET template's OpenIddict seed). */
export const TemplateAppClientId = "TemplateApp_App";

/** The languages of the .NET startup template's `MyProjectNameDomainModule`. */
export const templateAppLanguages: readonly LanguageInfo[] = [
  new LanguageInfo("ar", "ar", "العربية"),
  new LanguageInfo("cs", "cs", "Čeština"),
  new LanguageInfo("en", "en", "English"),
  new LanguageInfo("en-GB", "en-GB", "English (UK)"),
  new LanguageInfo("hu", "hu", "Magyar"),
  new LanguageInfo("hr", "hr", "Croatian"),
  new LanguageInfo("fi", "fi", "Finnish"),
  new LanguageInfo("fr", "fr", "Français"),
  new LanguageInfo("hi", "hi", "Hindi"),
  new LanguageInfo("it", "it", "Italiano"),
  new LanguageInfo("pt-BR", "pt-BR", "Português"),
  new LanguageInfo("ru", "ru", "Русский"),
  new LanguageInfo("sk", "sk", "Slovak"),
  new LanguageInfo("tr", "tr", "Türkçe"),
  new LanguageInfo("zh-Hans", "zh-Hans", "简体中文"),
  new LanguageInfo("zh-Hant", "zh-Hant", "繁體中文"),
  new LanguageInfo("de-DE", "de-DE", "Deutsch"),
  new LanguageInfo("es", "es", "Español"),
];

/**
 * Port of the .NET startup template's module chain (`MyProjectNameDomainSharedModule` → `DomainModule` →
 * `ApplicationContractsModule` → `ApplicationModule` → `HttpApiModule` → `HttpApiHostModule`) folded into one
 * provider-independent module: framework hosting modules, every application module's domain/application/HTTP API
 * layers, the sample book feature and the host configuration (multi-tenancy, JWT, auditing, caching,
 * localization). Persistence and AWS providers are chosen by `TemplateAppHostModule` / `TemplateAppLocalModule`.
 */
@DependsOn(
  AbpAspNetCoreMvcModule,
  AbpAspNetCoreMultiTenancyModule,
  AbpAspNetCoreAuthenticationJwtBearerModule,
  AbpSwashbuckleModule,
  AbpDddApplicationModule,
  AbpCachingModule,
  AbpBlobStoringModule,
  AbpBackgroundJobsModule,
  AbpBackgroundWorkersModule,
  AbpEventBusModule,
  AbpEmailingModule,
  AbpSmsModule,
  AbpDistributedLockingModule,
  AbpIdentityApplicationModule,
  AbpIdentityHttpApiModule,
  AbpIdentityAuthModule,
  AbpPermissionManagementApplicationModule,
  AbpPermissionManagementHttpApiModule,
  AbpPermissionManagementDomainIdentityModule,
  AbpPermissionManagementDomainOpenIddictModule,
  AbpSettingManagementApplicationModule,
  AbpSettingManagementHttpApiModule,
  AbpFeatureManagementApplicationModule,
  AbpFeatureManagementHttpApiModule,
  AbpTenantManagementApplicationModule,
  AbpTenantManagementHttpApiModule,
  AbpAuditLoggingDomainModule,
  AbpBackgroundJobsDomainModule,
  AbpAccountApplicationModule,
  AbpAccountHttpApiModule,
)
export class TemplateAppModule extends AbpModule {
  override configureServices(): void {
    this.configure(AbpLocalizationOptions, (options) => {
      options.resources.add(TemplateAppResource, "en").addBaseTypes(AbpValidationResource).addJson(templateAppEn);
      options.defaultResourceType = TemplateAppResource;
      options.languages.push(...templateAppLanguages);
    });
    this.configure(AbpExceptionLocalizationOptions, (options) => {
      options.mapCodeNamespace("TemplateApp", TemplateAppResource);
    });

    this.configure(AbpMultiTenancyOptions, (options) => {
      options.isEnabled = true;
    });

    this.configure(AbpJwtClientOptions, (options) => {
      if (!options.findClient(TemplateAppClientId)) {
        options.addClient(TemplateAppClientId, undefined, { displayName: "TemplateApp application", allowedGrantTypes: [OpenIddictConstants.GrantTypes.Password, OpenIddictConstants.GrantTypes.RefreshToken] });
      }
    });

    this.configure(AbpAuditingOptions, (options) => {
      options.applicationName ??= "TemplateApp";
      options.isEnabledForGetRequests = false;
    });

    this.configure(AbpDistributedCacheOptions, (options) => {
      options.keyPrefix = "TemplateApp:";
    });

    this.configure(AbpObjectMappingOptions, (options) => {
      options.addProfile(TemplateAppMappingProfile);
    });

    this.configure(AbpSwaggerGenOptions, (options) => {
      options.swaggerDoc("v1", { title: "TemplateApp API", version: "v1" });
      options.hideAbpEndpoints = false;
    });
    this.configure(AbpSwaggerUIOptions, (options) => {
      options.documentTitle = "TemplateApp API";
      options.oauthClientId = TemplateAppClientId;
    });
  }
}
