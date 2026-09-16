import { createToken } from "@abp/core";
import type { IApplicationService } from "@abp/ddd-application";
import type { GetFeatureListResultDto, UpdateFeaturesDto } from "./dtos.js";

/** Port of `FeatureManagementRemoteServiceConsts`. */
export const FeatureManagementRemoteServiceConsts = {
  RemoteServiceName: "AbpFeatureManagement",
  ModuleName: "featureManagement",
} as const;

/** Port of `IFeatureAppService`. */
export interface IFeatureAppService extends IApplicationService {
  get(providerName: string, providerKey: string | undefined): Promise<GetFeatureListResultDto>;
  update(providerName: string, providerKey: string | undefined, input: UpdateFeaturesDto): Promise<void>;
  delete(providerName: string, providerKey: string | undefined): Promise<void>;
}
export const IFeatureAppService = createToken<IFeatureAppService>("IFeatureAppService");
