import { CultureHelper, type Guid, type IServiceProvider, type IServiceProviderAccessor, type NameValue } from "@abp/core";
import type { LanguageInfo } from "@abp/localization";
import { TenantUserSharingStrategy } from "@abp/multi-tenancy-abstractions";
import { z } from "zod";

/* Port of Volo.Abp.AspNetCore.Mvc.Contracts (ApplicationConfigurations + MultiTenancy DTOs). */

/** Port of `ApplicationConfigurationRequestOptions` (bound from the query string). */
export class ApplicationConfigurationRequestOptions {
  static readonly schema = z.object({ includeLocalizationResources: z.boolean().default(true) });
  includeLocalizationResources = true;
}

/** Port of `ApplicationLocalizationRequestDto`. */
export class ApplicationLocalizationRequestDto {
  static readonly schema = z.object({ cultureName: z.string().min(1), onlyDynamics: z.boolean().default(false) });
  cultureName = "";
  onlyDynamics = false;
}

export class ApplicationAuthConfigurationDto {
  grantedPolicies: Record<string, boolean> = {};
}

export class ApplicationSettingConfigurationDto {
  values: Record<string, string | undefined> = {};
}

export class ApplicationFeatureConfigurationDto {
  values: Record<string, string | undefined> = {};
}

export class ApplicationGlobalFeatureConfigurationDto {
  enabledFeatures: string[] = [];
}

export class DateTimeFormatDto {
  calendarAlgorithmType = "SolarCalendar";
  dateTimeFormatLong = "";
  shortDatePattern = "";
  fullDateTimePattern = "";
  dateSeparator = "/";
  shortTimePattern = "";
  longTimePattern = "";
}

/** Port of `CurrentCultureDto`; `create()` reads the ambient UI culture through `Intl` (no `CultureInfo`). */
export class CurrentCultureDto {
  displayName = "";
  englishName = "";
  threeLetterIsoLanguageName = "";
  twoLetterIsoLanguageName = "";
  isRightToLeft = false;
  cultureName = "";
  name = "";
  nativeName = "";
  dateTimeFormat = new DateTimeFormatDto();

  static create(cultureName = CultureHelper.currentUICulture): CurrentCultureDto {
    const dto = new CurrentCultureDto();
    dto.name = cultureName;
    dto.cultureName = cultureName;
    dto.isRightToLeft = CultureHelper.isRtl(cultureName);
    dto.twoLetterIsoLanguageName = CultureHelper.getBaseCultureName(cultureName);
    dto.threeLetterIsoLanguageName = dto.twoLetterIsoLanguageName;
    dto.englishName = displayNameOf(cultureName, "en") ?? cultureName;
    dto.nativeName = displayNameOf(cultureName, cultureName) ?? cultureName;
    dto.displayName = dto.englishName;
    dto.dateTimeFormat = dateTimeFormatOf(cultureName);
    return dto;
  }
}

function displayNameOf(culture: string, inLocale: string): string | undefined {
  try {
    return new Intl.DisplayNames([inLocale], { type: "language" }).of(culture);
  } catch {
    return undefined;
  }
}

/** Derives .NET-style patterns (`M/d/yyyy`, `HH:mm`) from `Intl.DateTimeFormat` parts. */
function dateTimeFormatOf(culture: string): DateTimeFormatDto {
  const dto = new DateTimeFormatDto();
  try {
    const shortDate = new Intl.DateTimeFormat(culture, { year: "numeric", month: "numeric", day: "numeric" });
    const longDate = new Intl.DateTimeFormat(culture, { year: "numeric", month: "long", day: "numeric", weekday: "long" });
    const shortTime = new Intl.DateTimeFormat(culture, { hour: "numeric", minute: "2-digit" });
    const longTime = new Intl.DateTimeFormat(culture, { hour: "numeric", minute: "2-digit", second: "2-digit" });
    dto.shortDatePattern = toPattern(shortDate);
    dto.dateTimeFormatLong = toPattern(longDate);
    dto.shortTimePattern = toPattern(shortTime);
    dto.longTimePattern = toPattern(longTime);
    dto.fullDateTimePattern = `${dto.dateTimeFormatLong} ${dto.longTimePattern}`;
    dto.dateSeparator = shortDate.formatToParts(new Date(2000, 0, 2)).find((p) => p.type === "literal")?.value.trim() || "/";
  } catch {
    dto.shortDatePattern = "M/d/yyyy";
    dto.shortTimePattern = "HH:mm";
    dto.longTimePattern = "HH:mm:ss";
    dto.dateTimeFormatLong = "dddd, MMMM d, yyyy";
    dto.fullDateTimePattern = `${dto.dateTimeFormatLong} ${dto.longTimePattern}`;
  }
  return dto;
}

function toPattern(format: Intl.DateTimeFormat): string {
  const options = format.resolvedOptions();
  const hour12 = options.hour12 ?? false;
  return format
    .formatToParts(new Date(2000, 0, 2, 13, 4, 5))
    .map((part) => {
      switch (part.type) {
        case "year":
          return part.value.length === 2 ? "yy" : "yyyy";
        case "month":
          return options.month === "long" ? "MMMM" : options.month === "short" ? "MMM" : part.value.length === 2 ? "MM" : "M";
        case "day":
          return part.value.length === 2 ? "dd" : "d";
        case "weekday":
          return options.weekday === "long" ? "dddd" : "ddd";
        case "hour":
          return hour12 ? (part.value.length === 2 ? "hh" : "h") : part.value.length === 2 ? "HH" : "H";
        case "minute":
          return "mm";
        case "second":
          return "ss";
        case "dayPeriod":
          return "tt";
        default:
          return part.value;
      }
    })
    .join("");
}

/** Port of `CurrentUserDto`. */
export class CurrentUserDto {
  isAuthenticated = false;
  id: Guid | undefined;
  tenantId: Guid | undefined;
  impersonatorUserId: Guid | undefined;
  impersonatorTenantId: Guid | undefined;
  impersonatorUserName: string | undefined;
  impersonatorTenantName: string | undefined;
  userName: string | undefined;
  name: string | undefined;
  surName: string | undefined;
  email: string | undefined;
  emailVerified = false;
  phoneNumber: string | undefined;
  phoneNumberVerified = false;
  roles: string[] = [];
  sessionId: string | undefined;
}

/** Port of `ApplicationLocalizationResourceDto`. */
export class ApplicationLocalizationResourceDto {
  texts: Record<string, string> = {};
  baseResources: string[] = [];
}

/** Port of `ApplicationLocalizationDto`. */
export class ApplicationLocalizationDto {
  resources: Record<string, ApplicationLocalizationResourceDto> = {};
  currentCulture = new CurrentCultureDto();
}

/** Port of `ApplicationLocalizationConfigurationDto`. */
export class ApplicationLocalizationConfigurationDto {
  /** Filled only when `includeLocalizationResources` is true. */
  values: Record<string, Record<string, string>> = {};
  /** Never filled by the configuration endpoint; clients fill it from the localization endpoint. */
  resources: Record<string, ApplicationLocalizationResourceDto> = {};
  languages: LanguageInfo[] = [];
  currentCulture = new CurrentCultureDto();
  defaultResourceName: string | undefined;
  languagesMap: Record<string, NameValue[]> = {};
  languageFilesMap: Record<string, NameValue[]> = {};
  useRouteBasedCulture = false;
}

/** Port of `MultiTenancyInfoDto`. */
export class MultiTenancyInfoDto {
  isEnabled = false;
  userSharingStrategy: TenantUserSharingStrategy = TenantUserSharingStrategy.Isolated;
}

/** Port of `CurrentTenantDto`. */
export class CurrentTenantDto {
  id: Guid | undefined;
  name: string | undefined;
  isAvailable = false;
}

/** Port of `FindTenantResultDto`. */
export class FindTenantResultDto {
  success = false;
  tenantId: Guid | undefined;
  name: string | undefined;
  normalizedName: string | undefined;
  isActive = false;
}

export class WindowsTimeZone {
  timeZoneId: string | undefined;
}

export class IanaTimeZone {
  timeZoneName: string | undefined;
}

export class TimeZone {
  iana = new IanaTimeZone();
  windows = new WindowsTimeZone();
}

/** Port of `TimingDto`. */
export class TimingDto {
  timeZone = new TimeZone();
}

/** Port of `ClockDto`. */
export class ClockDto {
  kind = "Unspecified";
}

/* Port of the ObjectExtending DTOs. */

export class LocalizableStringDto {
  constructor(
    public name: string,
    public resource: string | undefined = undefined,
  ) {}
}

export class ExtensionPropertyApiGetDto {
  isAvailable = true;
}
export class ExtensionPropertyApiCreateDto {
  isAvailable = true;
}
export class ExtensionPropertyApiUpdateDto {
  isAvailable = true;
}
export class ExtensionPropertyApiDto {
  onGet = new ExtensionPropertyApiGetDto();
  onCreate = new ExtensionPropertyApiCreateDto();
  onUpdate = new ExtensionPropertyApiUpdateDto();
}

export class ExtensionPropertyUiTableDto {
  isVisible = false;
}
export class ExtensionPropertyUiFormDto {
  isVisible = false;
}
export class ExtensionPropertyUiLookupDto {
  url = "";
  resultListPropertyName = "";
  displayPropertyName = "";
  valuePropertyName = "";
  filterParamName = "";
}
export class ExtensionPropertyUiDto {
  onTable = new ExtensionPropertyUiTableDto();
  onCreateForm = new ExtensionPropertyUiFormDto();
  onEditForm = new ExtensionPropertyUiFormDto();
  lookup = new ExtensionPropertyUiLookupDto();
}

export class ExtensionPropertyGlobalFeaturePolicyDto {
  features: string[] = [];
  requiresAll = false;
}
export class ExtensionPropertyFeaturePolicyDto {
  features: string[] = [];
  requiresAll = false;
}
export class ExtensionPropertyPermissionPolicyDto {
  permissionNames: string[] = [];
  requiresAll = false;
}
export class ExtensionPropertyPolicyDto {
  globalFeatures = new ExtensionPropertyGlobalFeaturePolicyDto();
  features = new ExtensionPropertyFeaturePolicyDto();
  permissions = new ExtensionPropertyPermissionPolicyDto();
}

export class ExtensionPropertyAttributeDto {
  typeSimple = "";
  config: Record<string, unknown> = {};
}

export class ExtensionPropertyDto {
  type = "";
  typeSimple = "";
  displayName: LocalizableStringDto | undefined;
  api = new ExtensionPropertyApiDto();
  ui = new ExtensionPropertyUiDto();
  policy = new ExtensionPropertyPolicyDto();
  attributes: ExtensionPropertyAttributeDto[] = [];
  configuration: Record<string, unknown> = {};
  defaultValue: unknown;
}

export class EntityExtensionDto {
  properties: Record<string, ExtensionPropertyDto> = {};
  configuration: Record<string, unknown> = {};
}

export class ModuleExtensionDto {
  entities: Record<string, EntityExtensionDto> = {};
  configuration: Record<string, unknown> = {};
}

export class ExtensionEnumFieldDto {
  name: string | undefined;
  value: unknown;
}

export class ExtensionEnumDto {
  fields: ExtensionEnumFieldDto[] = [];
  localizationResource: string | undefined;
}

export class ObjectExtensionsDto {
  modules: Record<string, ModuleExtensionDto> = {};
  enums: Record<string, ExtensionEnumDto> = {};
}

/** Port of `ApplicationConfigurationDto`. */
export class ApplicationConfigurationDto {
  localization = new ApplicationLocalizationConfigurationDto();
  auth = new ApplicationAuthConfigurationDto();
  setting = new ApplicationSettingConfigurationDto();
  currentUser = new CurrentUserDto();
  features = new ApplicationFeatureConfigurationDto();
  globalFeatures = new ApplicationGlobalFeatureConfigurationDto();
  multiTenancy = new MultiTenancyInfoDto();
  currentTenant = new CurrentTenantDto();
  timing = new TimingDto();
  clock = new ClockDto();
  objectExtensions = new ObjectExtensionsDto();
  extraProperties: Record<string, unknown> = {};
}

/** Port of `ApplicationConfigurationContributorContext`. */
export class ApplicationConfigurationContributorContext implements IServiceProviderAccessor {
  constructor(
    readonly serviceProvider: IServiceProvider,
    readonly applicationConfiguration: ApplicationConfigurationDto,
  ) {}
}

/** Port of `IApplicationConfigurationContributor`. */
export interface IApplicationConfigurationContributor {
  contribute(context: ApplicationConfigurationContributorContext): Promise<void>;
}

/** Port of `AbpApplicationConfigurationOptions`. */
export class AbpApplicationConfigurationOptions {
  readonly contributors: IApplicationConfigurationContributor[] = [];
}

/** Port of `CurrentApplicationConfigurationCacheResetEventData`. */
export class CurrentApplicationConfigurationCacheResetEventData {
  constructor(public userId: Guid | undefined = undefined) {}
}
