import { Transient } from "@abp/core";
import { DisableAuditing } from "@abp/auditing";
import { IApiDescriptionModelProvider, type ApplicationApiDescriptionModel } from "@abp/http";
import { z } from "zod";
import { AbpControllerBase } from "../abp-controller-base.js";
import { Controller, HttpGet, query } from "../controller.js";
import { IAbpApplicationConfigurationAppService, IAbpApplicationLocalizationAppService } from "./app-services.js";
import { ApplicationConfigurationRequestOptions, ApplicationLocalizationRequestDto, type ApplicationConfigurationDto, type ApplicationLocalizationDto } from "./dtos.js";

/** Port of `AbpApplicationConfigurationController`: `GET /api/abp/application-configuration?includeLocalizationResources=`. */
@Transient()
@Controller("api/abp/application-configuration", { area: "abp", remoteServiceName: "abp" })
export class AbpApplicationConfigurationController extends AbpControllerBase {
  static readonly inject = [IAbpApplicationConfigurationAppService] as const;

  constructor(protected readonly applicationConfigurationAppService: IAbpApplicationConfigurationAppService) {
    super();
  }

  @HttpGet("", query(ApplicationConfigurationRequestOptions))
  async get(options: ApplicationConfigurationRequestOptions): Promise<ApplicationConfigurationDto> {
    return this.applicationConfigurationAppService.get(options);
  }
}

/** Port of `AbpApplicationLocalizationController`: `GET /api/abp/application-localization?cultureName=&onlyDynamics=`. */
@Transient()
@Controller("api/abp/application-localization", { area: "abp", remoteServiceName: "abp" })
export class AbpApplicationLocalizationController extends AbpControllerBase {
  static readonly inject = [IAbpApplicationLocalizationAppService] as const;

  constructor(private readonly localizationAppService: IAbpApplicationLocalizationAppService) {
    super();
  }

  @HttpGet("", query(ApplicationLocalizationRequestDto))
  async get(input: ApplicationLocalizationRequestDto): Promise<ApplicationLocalizationDto> {
    return this.localizationAppService.get(input);
  }
}

export class ApplicationApiDescriptionModelRequestOptions {
  static readonly schema = z.object({ includeTypes: z.boolean().default(false), includeDescriptions: z.boolean().default(false) });
  includeTypes = false;
  includeDescriptions = false;
}

/** Port of `AbpApiDefinitionController`: `GET /api/abp/api-definition`. */
@Transient()
@DisableAuditing()
@Controller("api/abp/api-definition", { area: "abp", remoteServiceName: "abp" })
export class AbpApiDefinitionController extends AbpControllerBase {
  static readonly inject = [IApiDescriptionModelProvider] as const;

  constructor(private readonly modelProvider: IApiDescriptionModelProvider) {
    super();
  }

  @HttpGet("", query(ApplicationApiDescriptionModelRequestOptions))
  async get(input: ApplicationApiDescriptionModelRequestOptions): Promise<ApplicationApiDescriptionModel> {
    return this.modelProvider.createApiModel(input);
  }
}
