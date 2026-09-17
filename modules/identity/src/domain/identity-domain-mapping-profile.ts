import { MappingProfile } from "@abp/object-mapping";
import { ExtraPropertyDictionary } from "@abp/object-extending";
import { UserEto } from "@abp/users/domain-shared";
import { IdentityClaimTypeEto, IdentityRoleEto, OrganizationUnitEto } from "../domain-shared/index.js";
import { IdentityClaimType } from "./identity-claim-type.js";
import { IdentityRole } from "./identity-role.js";
import { IdentityUser } from "./identity-user.js";
import { OrganizationUnit } from "./organization-unit.js";

/** Port of `IdentityDomainMappers` (the Mapperly entity → ETO mappers). */
export class IdentityDomainMappingProfile extends MappingProfile {
  constructor() {
    super();
    this.createMap(IdentityUser, UserEto, (user) => {
      const eto = new UserEto();
      eto.id = user.id;
      eto.tenantId = user.tenantId;
      eto.userName = user.userName;
      eto.name = user.name;
      eto.surname = user.surname;
      eto.isActive = user.isActive;
      eto.email = user.email;
      eto.emailConfirmed = user.emailConfirmed;
      eto.phoneNumber = user.phoneNumber;
      eto.phoneNumberConfirmed = user.phoneNumberConfirmed;
      eto.extraProperties = new ExtraPropertyDictionary(user.extraProperties);
      return eto;
    });
    this.createMap(IdentityRole, IdentityRoleEto, (role) => {
      const eto = new IdentityRoleEto();
      eto.id = role.id;
      eto.tenantId = role.tenantId;
      eto.name = role.name;
      eto.isDefault = role.isDefault;
      eto.isStatic = role.isStatic;
      eto.isPublic = role.isPublic;
      eto.entityVersion = role.entityVersion;
      return eto;
    });
    this.createMap(IdentityClaimType, IdentityClaimTypeEto, (claimType) => {
      const eto = new IdentityClaimTypeEto();
      eto.id = claimType.id;
      eto.name = claimType.name;
      eto.required = claimType.required;
      eto.isStatic = claimType.isStatic;
      eto.regex = claimType.regex;
      eto.regexDescription = claimType.regexDescription;
      eto.description = claimType.description;
      eto.valueType = claimType.valueType;
      return eto;
    });
    this.createMap(OrganizationUnit, OrganizationUnitEto, (organizationUnit) => {
      const eto = new OrganizationUnitEto();
      eto.id = organizationUnit.id;
      eto.tenantId = organizationUnit.tenantId;
      eto.parentId = organizationUnit.parentId;
      eto.code = organizationUnit.code;
      eto.displayName = organizationUnit.displayName;
      eto.entityVersion = organizationUnit.entityVersion;
      return eto;
    });
  }
}
