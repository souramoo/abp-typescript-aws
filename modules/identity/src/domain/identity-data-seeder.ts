import { Check, Transient, createToken, isNullOrWhiteSpace, type Guid } from "@abp/core";
import { DataSeedContributor, type DataSeedContext, type IDataSeedContributor } from "@abp/data";
import { IGuidGenerator } from "@abp/guids";
import { ICurrentTenant } from "@abp/multi-tenancy-abstractions";
import { AbpRoleConsts } from "@abp/security";
import { ILookupNormalizer } from "./identity-options.js";
import { IdentityRole } from "./identity-role.js";
import { IdentityRoleManager } from "./identity-role-manager.js";
import { IdentityUser } from "./identity-user.js";
import { IdentityUserManager } from "./identity-user-manager.js";
import { IIdentityRoleRepository, IIdentityUserRepository } from "./repositories.js";

/** Port of `IdentityDataSeedResult`. */
export class IdentityDataSeedResult {
  createdAdminUser = false;
  createdAdminRole = false;
}

/** Port of `IIdentityDataSeeder`. */
export interface IIdentityDataSeeder {
  seed(adminEmail: string, adminPassword: string, tenantId?: Guid, adminUserName?: string): Promise<IdentityDataSeedResult>;
}
export const IIdentityDataSeeder = createToken<IIdentityDataSeeder>("IIdentityDataSeeder");

/** Port of `IdentityDataSeeder`: creates the `admin` user and the static, public `admin` role. */
@Transient(IIdentityDataSeeder)
export class IdentityDataSeeder implements IIdentityDataSeeder {
  static readonly inject = [IGuidGenerator, IIdentityRoleRepository, IIdentityUserRepository, ILookupNormalizer, IdentityUserManager, IdentityRoleManager, ICurrentTenant] as const;

  constructor(
    protected readonly guidGenerator: IGuidGenerator,
    protected readonly roleRepository: IIdentityRoleRepository,
    protected readonly userRepository: IIdentityUserRepository,
    protected readonly lookupNormalizer: ILookupNormalizer,
    protected readonly userManager: IdentityUserManager,
    protected readonly roleManager: IdentityRoleManager,
    protected readonly currentTenant: ICurrentTenant,
  ) {}

  async seed(adminEmail: string, adminPassword: string, tenantId?: Guid, adminUserName?: string): Promise<IdentityDataSeedResult> {
    Check.notNullOrWhiteSpace(adminEmail, "adminEmail");
    Check.notNullOrWhiteSpace(adminPassword, "adminPassword");
    return this.currentTenant.run(tenantId, undefined, async () => {
      const result = new IdentityDataSeedResult();
      const userName = isNullOrWhiteSpace(adminUserName) ? IdentityDataSeedContributor.AdminUserNameDefaultValue : adminUserName;

      let adminUser = await this.userRepository.findByNormalizedUserName(this.lookupNormalizer.normalizeName(userName) ?? userName.toUpperCase());
      if (adminUser) return result;

      adminUser = new IdentityUser(this.guidGenerator.create(), userName, adminEmail, tenantId);
      adminUser.name = userName;
      (await this.userManager.create(adminUser, adminPassword, false)).checkErrors();
      result.createdAdminUser = true;

      const adminRoleName = AbpRoleConsts.adminRoleName;
      let adminRole = await this.roleRepository.findByNormalizedName(this.lookupNormalizer.normalizeName(adminRoleName) ?? adminRoleName.toUpperCase());
      if (!adminRole) {
        adminRole = new IdentityRole(this.guidGenerator.create(), adminRoleName, tenantId);
        adminRole.isStatic = true;
        adminRole.isPublic = true;
        (await this.roleManager.create(adminRole)).checkErrors();
        result.createdAdminRole = true;
      }

      (await this.userManager.addToRole(adminUser, adminRoleName)).checkErrors();
      return result;
    });
  }
}

/** Port of `IdentityDataSeedContributor`: reads `AdminEmail`/`AdminPassword`/`AdminUserName` from the seed context. */
@Transient()
@DataSeedContributor()
export class IdentityDataSeedContributor implements IDataSeedContributor {
  static readonly AdminEmailPropertyName = "AdminEmail";
  static readonly AdminEmailDefaultValue = "admin@abp.io";
  static readonly AdminUserNamePropertyName = "AdminUserName";
  static readonly AdminUserNameDefaultValue = "admin";
  static readonly AdminPasswordPropertyName = "AdminPassword";
  static readonly AdminPasswordDefaultValue = "1q2w3E*";
  static readonly inject = [IIdentityDataSeeder] as const;

  constructor(protected readonly identityDataSeeder: IIdentityDataSeeder) {}

  async seed(context: DataSeedContext): Promise<void> {
    await this.identityDataSeeder.seed(
      stringProperty(context, IdentityDataSeedContributor.AdminEmailPropertyName) ?? IdentityDataSeedContributor.AdminEmailDefaultValue,
      stringProperty(context, IdentityDataSeedContributor.AdminPasswordPropertyName) ?? IdentityDataSeedContributor.AdminPasswordDefaultValue,
      context.tenantId,
      stringProperty(context, IdentityDataSeedContributor.AdminUserNamePropertyName) ?? IdentityDataSeedContributor.AdminUserNameDefaultValue,
    );
  }
}

function stringProperty(context: DataSeedContext, name: string): string | undefined {
  const value = context.get(name);
  return typeof value === "string" ? value : undefined;
}
