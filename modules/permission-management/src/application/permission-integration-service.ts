import { IntegrationService, Transient } from "@abp/core";
import { ApplicationService, ListResultDto } from "@abp/ddd-application";
import { IPermissionIntegrationService } from "../application-contracts/index.js";
import { IPermissionFinder, type IsGrantedRequest, type IsGrantedResponse } from "../domain-shared/index.js";

/** Port of `PermissionIntegrationService`. */
@Transient(IPermissionIntegrationService)
@IntegrationService()
export class PermissionIntegrationService extends ApplicationService implements IPermissionIntegrationService {
  static readonly inject = [IPermissionFinder] as const;

  constructor(protected readonly permissionFinder: IPermissionFinder) {
    super();
  }

  async isGranted(input: readonly IsGrantedRequest[]): Promise<ListResultDto<IsGrantedResponse>> {
    return new ListResultDto(await this.permissionFinder.isGranted(input));
  }
}
