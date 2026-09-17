import { BusinessException, Transient, type Guid } from "@abp/core";
import { DomainService } from "@abp/ddd-domain";
import { IdentityErrorCodes } from "../domain-shared/index.js";
import { IdentityUserDelegation } from "./identity-user-delegation.js";
import { IIdentityUserDelegationRepository } from "./repositories.js";

/** Port of `IdentityUserDelegationManager`. */
@Transient()
export class IdentityUserDelegationManager extends DomainService {
  static readonly inject = [IIdentityUserDelegationRepository] as const;

  constructor(protected readonly identityUserDelegationRepository: IIdentityUserDelegationRepository) {
    super();
  }

  async getList(sourceUserId?: Guid, targetUserId?: Guid): Promise<IdentityUserDelegation[]> {
    return this.identityUserDelegationRepository.getListOf(sourceUserId, targetUserId);
  }

  async getActiveDelegations(targetUserId: Guid): Promise<IdentityUserDelegation[]> {
    return this.identityUserDelegationRepository.getActiveDelegations(targetUserId);
  }

  async findActiveDelegationById(id: Guid): Promise<IdentityUserDelegation | undefined> {
    return this.identityUserDelegationRepository.findActiveDelegationById(id);
  }

  async delegateNewUser(sourceUserId: Guid, targetUserId: Guid, startTime: Date, endTime: Date): Promise<void> {
    if (sourceUserId === targetUserId) throw new BusinessException({ code: IdentityErrorCodes.YouCannotDelegateYourself });
    await this.identityUserDelegationRepository.insert(new IdentityUserDelegation(this.guidGenerator.create(), sourceUserId, targetUserId, startTime, endTime, this.currentTenant.id));
  }

  async deleteDelegation(id: Guid, sourceUserId: Guid): Promise<void> {
    const delegation = await this.identityUserDelegationRepository.find(id);
    if (delegation && delegation.sourceUserId === sourceUserId) await this.identityUserDelegationRepository.delete(delegation);
  }
}
