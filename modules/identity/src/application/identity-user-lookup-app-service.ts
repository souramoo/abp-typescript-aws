import { Transient, type Guid } from "@abp/core";
import { Authorize } from "@abp/authorization";
import type { ListResultDto } from "@abp/ddd-application";
import type { UserData } from "@abp/users/domain-shared";
import { IIdentityUserIntegrationService, IIdentityUserLookupAppService, IdentityPermissions, type UserLookupCountInputDto, type UserLookupSearchInputDto } from "../application-contracts/index.js";
import { IdentityAppServiceBase } from "./identity-app-service-base.js";

/** Port of `IdentityUserLookupAppService` (delegates to the integration service; obsolete in .NET but still served). */
@Transient(IIdentityUserLookupAppService)
@Authorize(IdentityPermissions.UserLookup.Default)
export class IdentityUserLookupAppService extends IdentityAppServiceBase implements IIdentityUserLookupAppService {
  static readonly inject = [IIdentityUserIntegrationService] as const;

  constructor(protected readonly identityUserIntegrationService: IIdentityUserIntegrationService) {
    super();
  }

  async findById(id: Guid): Promise<UserData | undefined> {
    return this.identityUserIntegrationService.findById(id);
  }

  async findByUserName(userName: string): Promise<UserData | undefined> {
    return this.identityUserIntegrationService.findByUserName(userName);
  }

  async search(input: UserLookupSearchInputDto): Promise<ListResultDto<UserData>> {
    return this.identityUserIntegrationService.search(input);
  }

  async getCount(input: UserLookupCountInputDto): Promise<number> {
    return this.identityUserIntegrationService.getCount(input);
  }
}
