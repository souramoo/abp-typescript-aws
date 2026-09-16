import { Transient } from "@abp/core";
import { AbpControllerBase, Controller, HttpDelete, HttpGet, HttpPut, body, query } from "@abp/aws-lambda";
import { FeatureManagementRemoteServiceConsts, IFeatureAppService, UpdateFeaturesDto, type GetFeatureListResultDto } from "../application-contracts/index.js";

/** Port of `FeaturesController`; `providerName`/`providerKey` are query values like the .NET simple-type binding. */
@Transient()
@Controller("api/feature-management/features", { remoteServiceName: FeatureManagementRemoteServiceConsts.RemoteServiceName, area: FeatureManagementRemoteServiceConsts.ModuleName })
export class FeaturesController extends AbpControllerBase implements IFeatureAppService {
  static readonly inject = [IFeatureAppService] as const;

  constructor(protected readonly featureAppService: IFeatureAppService) {
    super();
  }

  @HttpGet("", query("providerName", { optional: false }), query("providerKey"))
  get(providerName: string, providerKey: string | undefined): Promise<GetFeatureListResultDto> {
    return this.featureAppService.get(providerName, providerKey);
  }

  @HttpPut("", query("providerName", { optional: false }), query("providerKey"), body(UpdateFeaturesDto))
  update(providerName: string, providerKey: string | undefined, input: UpdateFeaturesDto): Promise<void> {
    return this.featureAppService.update(providerName, providerKey, input);
  }

  @HttpDelete("", query("providerName", { optional: false }), query("providerKey"))
  delete(providerName: string, providerKey: string | undefined): Promise<void> {
    return this.featureAppService.delete(providerName, providerKey);
  }
}
