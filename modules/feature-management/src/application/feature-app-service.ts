import { AbpException, Transient, isNullOrEmptyString, optionsToken, type IOptions } from "@abp/core";
import { Authorize } from "@abp/authorization";
import { IFeatureDefinitionManager, TenantFeatureValueProvider, type FeatureDefinition, type FeatureGroupDefinition } from "@abp/features";
import { FeatureDto, FeatureGroupDto, FeatureManagementPermissions, FeatureProviderDto, GetFeatureListResultDto, IFeatureAppService, type UpdateFeatureDto, type UpdateFeaturesDto } from "../application-contracts/index.js";
import { FeatureManagementOptions, IFeatureManager, type FeatureNameValueWithGrantedProvider } from "../domain/index.js";
import { stringValueTypeToJson } from "../domain-shared/index.js";
import { FeatureManagementAppServiceBase } from "./feature-management-app-service-base.js";

/** Port of `FeatureAppService`: reads and writes the features of a provider (tenant, edition, ...) after its policy check. */
@Transient(IFeatureAppService)
@Authorize()
export class FeatureAppService extends FeatureManagementAppServiceBase implements IFeatureAppService {
  static readonly inject = [IFeatureManager, IFeatureDefinitionManager, optionsToken(FeatureManagementOptions)] as const;
  protected readonly options: FeatureManagementOptions;

  constructor(
    protected readonly featureManager: IFeatureManager,
    protected readonly featureDefinitionManager: IFeatureDefinitionManager,
    options: IOptions<FeatureManagementOptions>,
  ) {
    super();
    this.options = options.value;
  }

  async get(providerName: string, providerKey: string | undefined): Promise<GetFeatureListResultDto> {
    await this.checkProviderPolicy(providerName, providerKey);

    const result = new GetFeatureListResultDto();
    for (const group of await this.featureDefinitionManager.getGroups()) {
      const groupDto = this.createFeatureGroupDto(group);

      const includedFeatures = new Set<FeatureDefinition>();
      for (const featureDefinition of group.getFeaturesWithChildren()) {
        if (providerName === TenantFeatureValueProvider.ProviderName && this.currentTenant.id === undefined && providerKey === undefined && !featureDefinition.isAvailableToHost) continue;
        if (featureDefinition.allowedProviders.length > 0 && !featureDefinition.allowedProviders.includes(providerName)) continue;
        if (featureDefinition.parent !== undefined && !includedFeatures.has(featureDefinition.parent)) continue;

        includedFeatures.add(featureDefinition);
        const feature = await this.featureManager.getOrNullWithProvider(featureDefinition.name, providerName, providerKey);
        groupDto.features.push(this.createFeatureDto(feature, featureDefinition));
      }

      this.setFeatureDepth(groupDto.features, providerName, providerKey);
      if (groupDto.features.length > 0) result.groups.push(groupDto);
    }

    return result;
  }

  private createFeatureGroupDto(groupDefinition: FeatureGroupDefinition): FeatureGroupDto {
    const dto = new FeatureGroupDto();
    dto.name = groupDefinition.name;
    dto.displayName = groupDefinition.displayName.localize(this.stringLocalizerFactory).value;
    return dto;
  }

  private createFeatureDto(featureNameValueWithGrantedProvider: FeatureNameValueWithGrantedProvider, featureDefinition: FeatureDefinition): FeatureDto {
    const dto = new FeatureDto();
    dto.name = featureDefinition.name;
    dto.displayName = featureDefinition.displayName.localize(this.stringLocalizerFactory).value;
    dto.description = featureDefinition.description?.localize(this.stringLocalizerFactory).value;
    dto.valueType = stringValueTypeToJson(featureDefinition.valueType);
    dto.parentName = featureDefinition.parent?.name;
    dto.value = featureNameValueWithGrantedProvider.value;
    const provider = new FeatureProviderDto();
    provider.name = featureNameValueWithGrantedProvider.provider?.name;
    provider.key = featureNameValueWithGrantedProvider.provider?.key;
    dto.provider = provider;
    return dto;
  }

  async update(providerName: string, providerKey: string | undefined, input: UpdateFeaturesDto): Promise<void> {
    await this.checkProviderPolicy(providerName, providerKey);

    const featureMap = new Map(input.features.map((f) => [f.name, f]));
    const features = new Map<UpdateFeatureDto, UpdateFeatureDto[]>();
    const processed = new Set<string>();

    for (const feature of input.features) {
      if (processed.has(feature.name)) continue;
      processed.add(feature.name);

      const featureDefinition = await this.featureDefinitionManager.get(feature.name);
      const validChildren: UpdateFeatureDto[] = [];
      for (const childFeature of featureDefinition.children) {
        const childDto = featureMap.get(childFeature.name);
        if (childDto !== undefined && !processed.has(childFeature.name)) {
          processed.add(childFeature.name);
          validChildren.push(childDto);
        }
      }
      features.set(feature, validChildren);
    }

    for (const [feature, children] of features) {
      let forceToSet = false;
      for (const childFeature of children) {
        await this.featureManager.set(childFeature.name, childFeature.value ?? undefined, providerName, providerKey);
        const value = await this.featureManager.getOrNullWithProvider(childFeature.name, providerName, providerKey);
        if (value.provider?.name === providerName && value.provider.key === providerKey) forceToSet = true;
      }
      await this.featureManager.set(feature.name, feature.value ?? undefined, providerName, providerKey, forceToSet);
    }
  }

  protected setFeatureDepth(features: readonly FeatureDto[], providerName: string, providerKey: string | undefined, parentFeature?: FeatureDto, depth = 0): void {
    for (const feature of features) {
      if ((parentFeature === undefined && feature.parentName === undefined) || (parentFeature !== undefined && parentFeature.name === feature.parentName)) {
        feature.depth = depth;
        this.setFeatureDepth(features, providerName, providerKey, feature, depth + 1);
      }
    }
  }

  protected async checkProviderPolicy(providerName: string, providerKey: string | undefined): Promise<void> {
    let policyName: string | undefined;
    if (providerName === TenantFeatureValueProvider.ProviderName && this.currentTenant.id === undefined && providerKey === undefined) {
      policyName = FeatureManagementPermissions.ManageHostFeatures;
    } else {
      policyName = this.options.providerPolicies.get(providerName);
      if (isNullOrEmptyString(policyName)) throw new AbpException(`No policy defined to get/set permissions for the provider '${providerName}'. Use FeatureManagementOptions to map the policy.`);
    }
    await this.authorizationService.check(policyName);
  }

  async delete(providerName: string, providerKey: string | undefined): Promise<void> {
    await this.checkProviderPolicy(providerName, providerKey);
    await this.featureManager.delete(providerName, providerKey);
  }
}
