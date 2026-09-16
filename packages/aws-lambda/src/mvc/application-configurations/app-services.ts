import { AbpException, CultureHelper, FixedLocalizableString, ILoggerFactory, IServiceProviderToken, IStringLocalizerFactory, LocalizableString, Singleton, Transient, addIfNotContains, createToken, isNullOrWhiteSpace, optionsToken, type Class, type ILogger, type IOptions, type IServiceProvider, type LocalizedString } from "@abp/core";
import { IAbpAuthorizationPolicyProvider, IAbpAuthorizationService, IPermissionChecker, IPermissionDefinitionManager, PermissionGrantResult } from "@abp/authorization";
import { IFeatureChecker, IFeatureDefinitionManager } from "@abp/features";
import { GlobalFeatureManager } from "@abp/global-features";
import { AbpLocalizationOptions, IExternalLocalizationStore, ILanguageProvider, LocalizationResourceNameAttribute, ResourceNameLocalizableString, getLocalizationResourceName, isAbpStringLocalizer, isAbpStringLocalizerFactory } from "@abp/localization";
import { AbpMultiTenancyOptions, ICurrentTenant } from "@abp/multi-tenancy-abstractions";
import { ObjectExtensionManager, type ObjectExtensionInfo, type ObjectExtensionPropertyInfo } from "@abp/object-extending";
import { ICurrentUser, findImpersonatorTenantId, findImpersonatorTenantName, findImpersonatorUserId, findImpersonatorUserName, findSessionId } from "@abp/security";
import { ISettingDefinitionManager, ISettingProvider } from "@abp/settings";
import { AbpClockOptions, ITimezoneProvider, TimingSettingNames } from "@abp/timing";
import { z } from "zod";
import { AbpRequestLocalizationOptions } from "../../middleware/request-localization.js";
import {
  AbpApplicationConfigurationOptions,
  ApplicationAuthConfigurationDto,
  ApplicationConfigurationContributorContext,
  ApplicationConfigurationDto,
  type ApplicationConfigurationRequestOptions,
  ApplicationFeatureConfigurationDto,
  ApplicationGlobalFeatureConfigurationDto,
  ApplicationLocalizationConfigurationDto,
  ApplicationLocalizationDto,
  type ApplicationLocalizationRequestDto,
  ApplicationLocalizationResourceDto,
  ApplicationSettingConfigurationDto,
  ClockDto,
  CurrentCultureDto,
  CurrentTenantDto,
  CurrentUserDto,
  EntityExtensionDto,
  ExtensionPropertyDto,
  ExtensionPropertyUiLookupDto,
  LocalizableStringDto,
  ModuleExtensionDto,
  MultiTenancyInfoDto,
  ObjectExtensionsDto,
  TimingDto,
} from "./dtos.js";

/** Port of `IAbpApplicationConfigurationAppService`. */
export interface IAbpApplicationConfigurationAppService {
  get(options: ApplicationConfigurationRequestOptions): Promise<ApplicationConfigurationDto>;
}
export const IAbpApplicationConfigurationAppService = createToken<IAbpApplicationConfigurationAppService>("IAbpApplicationConfigurationAppService");

/** Port of `IAbpApplicationLocalizationAppService`. */
export interface IAbpApplicationLocalizationAppService {
  get(input: ApplicationLocalizationRequestDto): Promise<ApplicationLocalizationDto>;
}
export const IAbpApplicationLocalizationAppService = createToken<IAbpApplicationLocalizationAppService>("IAbpApplicationLocalizationAppService");

/** Port of `ICachedObjectExtensionsDtoService`. */
export interface ICachedObjectExtensionsDtoService {
  get(): ObjectExtensionsDto;
}
export const ICachedObjectExtensionsDtoService = createToken<ICachedObjectExtensionsDtoService>("ICachedObjectExtensionsDtoService");

/**
 * Port of `CachedObjectExtensionsDtoService`. `@abp/object-extending` has no module/entity registry
 * (`ObjectExtensionManager.Modules()`), so every extended class becomes an entity of the module named by its
 * `configuration.get("ModuleName")` (default `"App"`); zod attributes are summarised as one `schema` attribute.
 */
@Singleton(ICachedObjectExtensionsDtoService)
export class CachedObjectExtensionsDtoService implements ICachedObjectExtensionsDtoService {
  static readonly ModuleNameConfigurationKey = "ModuleName";
  static readonly DefaultModuleName = "App";
  private cachedValue: ObjectExtensionsDto | undefined;

  get(): ObjectExtensionsDto {
    this.cachedValue ??= this.generateCacheValue();
    return this.cachedValue;
  }

  protected generateCacheValue(): ObjectExtensionsDto {
    const dto = new ObjectExtensionsDto();
    for (const extension of ObjectExtensionManager.instance.getExtendedObjects()) {
      const moduleName = String(extension.configuration.get(CachedObjectExtensionsDtoService.ModuleNameConfigurationKey) ?? CachedObjectExtensionsDtoService.DefaultModuleName);
      const module = (dto.modules[moduleName] ??= new ModuleExtensionDto());
      module.entities[extension.type.name] = this.createEntityExtensionDto(extension);
    }
    return dto;
  }

  protected createEntityExtensionDto(extension: ObjectExtensionInfo): EntityExtensionDto {
    const entity = new EntityExtensionDto();
    for (const property of extension.getProperties()) entity.properties[property.name] = this.createExtensionPropertyDto(property);
    for (const [key, value] of extension.configuration) {
      if (typeof key === "string" && !key.startsWith("_") && key !== CachedObjectExtensionsDtoService.ModuleNameConfigurationKey) entity.configuration[key] = value;
    }
    return entity;
  }

  protected createExtensionPropertyDto(property: ObjectExtensionPropertyInfo): ExtensionPropertyDto {
    const dto = new ExtensionPropertyDto();
    dto.type = typeof property.type === "string" ? property.type : "object";
    dto.typeSimple = dto.type;
    dto.displayName = this.createDisplayNameDto(property);
    dto.defaultValue = property.getDefaultValue();
    dto.ui.onCreateForm.isVisible = property.ui.createModal.isVisible;
    dto.ui.onEditForm.isVisible = property.ui.editModal.isVisible;
    dto.ui.onTable.isVisible = true;
    dto.policy.globalFeatures.features = [...property.policy.globalFeatures.features];
    dto.policy.globalFeatures.requiresAll = property.policy.globalFeatures.requiresAll;
    dto.policy.features.features = [...property.policy.features.features];
    dto.policy.features.requiresAll = property.policy.features.requiresAll;
    dto.policy.permissions.permissionNames = [...property.policy.permissions.permissionNames];
    dto.policy.permissions.requiresAll = property.policy.permissions.requiresAll;
    if (!isNullOrWhiteSpace(property.lookup.url)) {
      const lookup = new ExtensionPropertyUiLookupDto();
      lookup.url = property.lookup.url;
      lookup.resultListPropertyName = property.lookup.resultListPropertyName;
      lookup.displayPropertyName = property.lookup.displayPropertyName;
      lookup.valuePropertyName = property.lookup.valuePropertyName;
      lookup.filterParamName = property.lookup.filterParamName;
      dto.ui.lookup = lookup;
    }
    if (property.type instanceof z.ZodType) dto.attributes.push({ typeSimple: "schema", config: { description: property.type.description ?? "" } });
    for (const [key, value] of property.configuration) {
      if (typeof key === "string" && !key.startsWith("_")) dto.configuration[key] = value;
    }
    return dto;
  }

  protected createDisplayNameDto(property: ObjectExtensionPropertyInfo): LocalizableStringDto | undefined {
    const displayName = property.displayName;
    if (!displayName) return undefined;
    if (displayName instanceof LocalizableString) return new LocalizableStringDto(displayName.name, getLocalizationResourceName(displayName.resource));
    if (displayName instanceof ResourceNameLocalizableString) return new LocalizableStringDto(displayName.name, displayName.resourceName);
    if (displayName instanceof FixedLocalizableString) return new LocalizableStringDto(displayName.value, "_");
    return undefined;
  }
}

/** Port of `AbpApplicationConfigurationAppService` as a plain service (no `ApplicationService` base). */
@Transient(IAbpApplicationConfigurationAppService)
export class AbpApplicationConfigurationAppService implements IAbpApplicationConfigurationAppService {
  static readonly inject = [
    optionsToken(AbpLocalizationOptions),
    optionsToken(AbpRequestLocalizationOptions),
    optionsToken(AbpMultiTenancyOptions),
    IServiceProviderToken,
    IAbpAuthorizationPolicyProvider,
    IPermissionDefinitionManager,
    IPermissionChecker,
    IAbpAuthorizationService,
    ICurrentUser,
    ICurrentTenant,
    ISettingProvider,
    ISettingDefinitionManager,
    IFeatureDefinitionManager,
    IFeatureChecker,
    ILanguageProvider,
    ITimezoneProvider,
    optionsToken(AbpClockOptions),
    ICachedObjectExtensionsDtoService,
    optionsToken(AbpApplicationConfigurationOptions),
    IStringLocalizerFactory,
    IExternalLocalizationStore,
    ILoggerFactory,
  ] as const;

  protected readonly localizationOptions: AbpLocalizationOptions;
  protected readonly requestLocalizationOptions: AbpRequestLocalizationOptions;
  protected readonly multiTenancyOptions: AbpMultiTenancyOptions;
  protected readonly clockOptions: AbpClockOptions;
  protected readonly options: AbpApplicationConfigurationOptions;
  protected readonly logger: ILogger;

  constructor(
    localizationOptions: IOptions<AbpLocalizationOptions>,
    requestLocalizationOptions: IOptions<AbpRequestLocalizationOptions>,
    multiTenancyOptions: IOptions<AbpMultiTenancyOptions>,
    protected readonly serviceProvider: IServiceProvider,
    protected readonly abpAuthorizationPolicyProvider: IAbpAuthorizationPolicyProvider,
    protected readonly permissionDefinitionManager: IPermissionDefinitionManager,
    protected readonly permissionChecker: IPermissionChecker,
    protected readonly authorizationService: IAbpAuthorizationService,
    protected readonly currentUser: ICurrentUser,
    protected readonly currentTenant: ICurrentTenant,
    protected readonly settingProvider: ISettingProvider,
    protected readonly settingDefinitionManager: ISettingDefinitionManager,
    protected readonly featureDefinitionManager: IFeatureDefinitionManager,
    protected readonly featureChecker: IFeatureChecker,
    protected readonly languageProvider: ILanguageProvider,
    protected readonly timezoneProvider: ITimezoneProvider,
    clockOptions: IOptions<AbpClockOptions>,
    protected readonly cachedObjectExtensionsDtoService: ICachedObjectExtensionsDtoService,
    options: IOptions<AbpApplicationConfigurationOptions>,
    protected readonly stringLocalizerFactory: IStringLocalizerFactory,
    protected readonly externalLocalizationStore: IExternalLocalizationStore,
    loggerFactory: ILoggerFactory,
  ) {
    this.localizationOptions = localizationOptions.value;
    this.requestLocalizationOptions = requestLocalizationOptions.value;
    this.multiTenancyOptions = multiTenancyOptions.value;
    this.clockOptions = clockOptions.value;
    this.options = options.value;
    this.logger = loggerFactory.createLogger(AbpApplicationConfigurationAppService.name);
  }

  async get(options: ApplicationConfigurationRequestOptions): Promise<ApplicationConfigurationDto> {
    this.logger.debug("Executing AbpApplicationConfigurationAppService.get()...");

    const result = new ApplicationConfigurationDto();
    result.auth = await this.getAuthConfig();
    result.features = await this.getFeaturesConfig();
    result.globalFeatures = await this.getGlobalFeaturesConfig();
    result.localization = await this.getLocalizationConfig(options);
    result.currentUser = this.getCurrentUser();
    result.setting = await this.getSettingConfig();
    result.multiTenancy = this.getMultiTenancy();
    result.currentTenant = this.getCurrentTenant();
    result.timing = await this.getTimingConfig();
    result.clock = this.getClockConfig();
    result.objectExtensions = this.cachedObjectExtensionsDtoService.get();

    if (this.options.contributors.length > 0) {
      const scope = this.serviceProvider.createScope();
      try {
        const context = new ApplicationConfigurationContributorContext(scope.serviceProvider, result);
        for (const contributor of this.options.contributors) await contributor.contribute(context);
      } finally {
        await scope.dispose();
      }
    }

    this.logger.debug("Executed AbpApplicationConfigurationAppService.get().");
    return result;
  }

  protected getCurrentTenant(): CurrentTenantDto {
    const dto = new CurrentTenantDto();
    dto.id = this.currentTenant.id;
    dto.name = this.currentTenant.name;
    dto.isAvailable = this.currentTenant.isAvailable;
    return dto;
  }

  protected getMultiTenancy(): MultiTenancyInfoDto {
    const dto = new MultiTenancyInfoDto();
    dto.isEnabled = this.multiTenancyOptions.isEnabled;
    dto.userSharingStrategy = this.multiTenancyOptions.userSharingStrategy;
    return dto;
  }

  protected getCurrentUser(): CurrentUserDto {
    const dto = new CurrentUserDto();
    dto.isAuthenticated = this.currentUser.isAuthenticated;
    dto.id = this.currentUser.id;
    dto.tenantId = this.currentUser.tenantId;
    dto.impersonatorUserId = findImpersonatorUserId(this.currentUser);
    dto.impersonatorTenantId = findImpersonatorTenantId(this.currentUser);
    dto.impersonatorUserName = findImpersonatorUserName(this.currentUser);
    dto.impersonatorTenantName = findImpersonatorTenantName(this.currentUser);
    dto.userName = this.currentUser.userName;
    dto.surName = this.currentUser.surName;
    dto.name = this.currentUser.name;
    dto.email = this.currentUser.email;
    dto.emailVerified = this.currentUser.emailVerified;
    dto.phoneNumber = this.currentUser.phoneNumber;
    dto.phoneNumberVerified = this.currentUser.phoneNumberVerified;
    dto.roles = this.currentUser.roles;
    dto.sessionId = findSessionId(this.currentUser);
    return dto;
  }

  protected async getAuthConfig(): Promise<ApplicationAuthConfigurationDto> {
    const authConfig = new ApplicationAuthConfigurationDto();
    const policyNames = await this.abpAuthorizationPolicyProvider.getPoliciesNames();
    const permissionNames = new Set((await this.permissionDefinitionManager.getPermissions()).map((p) => p.name));
    const abpPolicyNames: string[] = [];
    const otherPolicyNames: string[] = [];
    for (const policyName of policyNames) {
      if (permissionNames.has(policyName)) abpPolicyNames.push(policyName);
      else otherPolicyNames.push(policyName);
    }

    for (const policyName of otherPolicyNames) {
      if (await this.authorizationService.isGranted(policyName)) authConfig.grantedPolicies[policyName] = true;
    }

    const result = await this.permissionChecker.isGranted(abpPolicyNames);
    for (const [key, value] of result.result) {
      if (value === PermissionGrantResult.Granted) authConfig.grantedPolicies[key] = true;
    }
    return authConfig;
  }

  protected async getLocalizationConfig(options: ApplicationConfigurationRequestOptions): Promise<ApplicationLocalizationConfigurationDto> {
    const localizationConfig = new ApplicationLocalizationConfigurationDto();
    localizationConfig.languages.push(...(await this.languageProvider.getLanguagesAsync()));

    if (options.includeLocalizationResources) {
      const resourceNames = new Set([...[...this.localizationOptions.resources.values()].map((r) => r.resourceName), ...(await this.externalLocalizationStore.getResourceNamesAsync())]);
      for (const resourceName of resourceNames) {
        const dictionary: Record<string, string> = {};
        const localizer = await this.createByResourceNameOrNull(resourceName);
        if (localizer) {
          for (const localizedString of await this.getAllStrings(localizer, true, true, true)) dictionary[localizedString.name] = localizedString.value;
        }
        localizationConfig.values[resourceName] = dictionary;
      }
    }

    localizationConfig.currentCulture = CurrentCultureDto.create();
    if (this.localizationOptions.defaultResourceType) localizationConfig.defaultResourceName = LocalizationResourceNameAttribute.getName(this.localizationOptions.defaultResourceType);
    localizationConfig.languagesMap = Object.fromEntries(this.localizationOptions.languagesMap);
    localizationConfig.languageFilesMap = Object.fromEntries(this.localizationOptions.languageFilesMap);
    localizationConfig.useRouteBasedCulture = this.requestLocalizationOptions.useRouteBasedCulture;
    return localizationConfig;
  }

  protected async createByResourceNameOrNull(resourceName: string) {
    if (isAbpStringLocalizerFactory(this.stringLocalizerFactory)) return this.stringLocalizerFactory.createByResourceNameOrNullAsync(resourceName);
    try {
      return this.stringLocalizerFactory.createByResourceName(resourceName);
    } catch {
      return undefined;
    }
  }

  protected getAllStrings(localizer: NonNullable<Awaited<ReturnType<AbpApplicationConfigurationAppService["createByResourceNameOrNull"]>>>, includeParentCultures: boolean, includeBaseLocalizers: boolean, includeDynamicContributors: boolean): Promise<LocalizedString[]> {
    return isAbpStringLocalizer(localizer) ? localizer.getAllStringsAsync(includeParentCultures, includeBaseLocalizers, includeDynamicContributors) : Promise.resolve(localizer.getAllStrings(includeParentCultures, includeBaseLocalizers));
  }

  protected async getSettingConfig(): Promise<ApplicationSettingConfigurationDto> {
    const result = new ApplicationSettingConfigurationDto();
    const settingDefinitions = (await this.settingDefinitionManager.getAll()).filter((x) => x.isVisibleToClients);
    const settingValues = await this.settingProvider.getAll(settingDefinitions.map((x) => x.name));
    for (const settingValue of settingValues) result.values[settingValue.name] = settingValue.value;
    return result;
  }

  protected async getFeaturesConfig(): Promise<ApplicationFeatureConfigurationDto> {
    const result = new ApplicationFeatureConfigurationDto();
    for (const featureDefinition of await this.featureDefinitionManager.getAll()) {
      if (!featureDefinition.isVisibleToClients) continue;
      result.values[featureDefinition.name] = await this.featureChecker.getOrNull(featureDefinition.name);
    }
    return result;
  }

  protected async getGlobalFeaturesConfig(): Promise<ApplicationGlobalFeatureConfigurationDto> {
    const result = new ApplicationGlobalFeatureConfigurationDto();
    for (const enabledFeatureName of GlobalFeatureManager.instance.getEnabledFeatureNames()) addIfNotContains(result.enabledFeatures, enabledFeatureName);
    return result;
  }

  /** IANA only: the port has no Windows time zone mapping, so `windows.timeZoneId` stays undefined. */
  protected async getTimingConfig(): Promise<TimingDto> {
    const timeZone = await this.settingProvider.getOrNull(TimingSettingNames.TimeZone);
    const dto = new TimingDto();
    if (isNullOrWhiteSpace(timeZone)) return dto;
    try {
      if (this.timezoneProvider.getIanaTimezones().some((x) => x.value === timeZone)) {
        dto.timeZone.iana.timeZoneName = timeZone;
      } else {
        this.timezoneProvider.getTimeZoneInfo(timeZone);
        dto.timeZone.iana.timeZoneName = timeZone;
      }
    } catch (e) {
      this.logger.warn(`Exception occurred while getting timezone(${timeZone}) information`, undefined, e);
    }
    return dto;
  }

  protected getClockConfig(): ClockDto {
    const dto = new ClockDto();
    dto.kind = String(this.clockOptions.kind);
    return dto;
  }
}

/** Port of `AbpApplicationLocalizationAppService`. */
@Transient(IAbpApplicationLocalizationAppService)
export class AbpApplicationLocalizationAppService implements IAbpApplicationLocalizationAppService {
  static readonly inject = [IExternalLocalizationStore, optionsToken(AbpLocalizationOptions), IStringLocalizerFactory] as const;
  protected readonly localizationOptions: AbpLocalizationOptions;

  constructor(
    protected readonly externalLocalizationStore: IExternalLocalizationStore,
    localizationOptions: IOptions<AbpLocalizationOptions>,
    protected readonly stringLocalizerFactory: IStringLocalizerFactory,
  ) {
    this.localizationOptions = localizationOptions.value;
  }

  async get(input: ApplicationLocalizationRequestDto): Promise<ApplicationLocalizationDto> {
    if (!CultureHelper.isValidCultureCode(input.cultureName)) throw new AbpException("The selected culture is not valid! Make sure you enter a valid culture name.");

    return CultureHelper.run(input.cultureName, async () => {
      const resources = new Map([...this.localizationOptions.resources.values(), ...(await this.externalLocalizationStore.getResourcesAsync())].map((r) => [r.resourceName, r]));
      const localizationConfig = new ApplicationLocalizationDto();
      localizationConfig.currentCulture = CurrentCultureDto.create();

      for (const resource of resources.values()) {
        const dictionary: Record<string, string> = {};
        const localizer = isAbpStringLocalizerFactory(this.stringLocalizerFactory) ? await this.stringLocalizerFactory.createByResourceNameOrNullAsync(resource.resourceName) : this.stringLocalizerFactory.createByResourceName(resource.resourceName);
        if (localizer && isAbpStringLocalizer(localizer)) {
          const staticStrings = input.onlyDynamics ? new Map((await localizer.getAllStringsAsync(true, false, false)).map((s) => [s.name, s])) : undefined;
          for (const localizedString of await localizer.getAllStringsAsync(true, false, true)) {
            const staticString = staticStrings?.get(localizedString.name);
            if (staticString && staticString.value === localizedString.value) continue;
            dictionary[localizedString.name] = localizedString.value;
          }
        }
        const resourceDto = new ApplicationLocalizationResourceDto();
        resourceDto.texts = dictionary;
        resourceDto.baseResources = [...resource.baseResourceNames];
        localizationConfig.resources[resource.resourceName] = resourceDto;
      }
      return localizationConfig;
    });
  }
}

export type { Class };
