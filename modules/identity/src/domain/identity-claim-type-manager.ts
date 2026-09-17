import { BusinessException, Transient, type Guid } from "@abp/core";
import { DomainService } from "@abp/ddd-domain";
import { IdentityErrorCodes } from "../domain-shared/index.js";
import type { IdentityClaimType } from "./identity-claim-type.js";
import { IIdentityClaimTypeRepository, IIdentityRoleRepository, IIdentityUserRepository } from "./repositories.js";

/** Port of `IdentityClaimTypeManager`. */
@Transient()
export class IdentityClaimTypeManager extends DomainService {
  static readonly inject = [IIdentityClaimTypeRepository, IIdentityUserRepository, IIdentityRoleRepository] as const;

  constructor(
    protected readonly identityClaimTypeRepository: IIdentityClaimTypeRepository,
    protected readonly identityUserRepository: IIdentityUserRepository,
    protected readonly identityRoleRepository: IIdentityRoleRepository,
  ) {
    super();
  }

  async create(claimType: IdentityClaimType): Promise<IdentityClaimType> {
    if (await this.identityClaimTypeRepository.anyByName(claimType.name)) throw new BusinessException({ code: IdentityErrorCodes.ClaimNameExist }).withData("0", claimType.name);
    return this.identityClaimTypeRepository.insert(claimType);
  }

  async update(claimType: IdentityClaimType): Promise<IdentityClaimType> {
    if (await this.identityClaimTypeRepository.anyByName(claimType.name, claimType.id)) throw new BusinessException({ code: IdentityErrorCodes.ClaimNameExist }).withData("0", claimType.name);
    if (claimType.isStatic) throw new BusinessException({ code: IdentityErrorCodes.CanNotUpdateStaticClaimType });
    return this.identityClaimTypeRepository.update(claimType);
  }

  /** Deletes the claim type and every claim of that type from all users and roles. */
  async delete(id: Guid): Promise<void> {
    const claimType = await this.identityClaimTypeRepository.get(id);
    if (claimType.isStatic) throw new BusinessException({ code: IdentityErrorCodes.CanNotDeleteStaticClaimType });
    await this.identityUserRepository.removeClaimFromAllUsers(claimType.name);
    await this.identityRoleRepository.removeClaimFromAllRoles(claimType.name);
    await this.identityClaimTypeRepository.deleteById(id);
  }
}
