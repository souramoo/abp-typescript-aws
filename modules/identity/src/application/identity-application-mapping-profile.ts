import { MappingProfile } from "@abp/object-mapping";
import { mapExtraPropertiesTo } from "@abp/object-extending";
import { IdentityRoleDto, IdentityUserDto } from "../application-contracts/index.js";
import { IdentityRole, IdentityUser } from "../domain/index.js";

/** Port of `AbpIdentityApplicationMappers` (`[MapExtraProperties]` becomes `mapExtraPropertiesTo`). */
export class IdentityApplicationMappingProfile extends MappingProfile {
  constructor() {
    super();
    this.createMap(IdentityUser, IdentityUserDto, (user) => {
      const dto = new IdentityUserDto();
      dto.id = user.id;
      dto.tenantId = user.tenantId;
      dto.userName = user.userName;
      dto.name = user.name;
      dto.surname = user.surname;
      dto.email = user.email;
      dto.emailConfirmed = user.emailConfirmed;
      dto.phoneNumber = user.phoneNumber;
      dto.phoneNumberConfirmed = user.phoneNumberConfirmed;
      dto.isActive = user.isActive;
      dto.lockoutEnabled = user.lockoutEnabled;
      dto.accessFailedCount = user.accessFailedCount;
      dto.lockoutEnd = user.lockoutEnd;
      dto.concurrencyStamp = user.concurrencyStamp;
      dto.entityVersion = user.entityVersion;
      dto.lastPasswordChangeTime = user.lastPasswordChangeTime;
      dto.creationTime = user.creationTime;
      dto.creatorId = user.creatorId;
      dto.lastModificationTime = user.lastModificationTime;
      dto.lastModifierId = user.lastModifierId;
      dto.isDeleted = user.isDeleted;
      dto.deleterId = user.deleterId;
      dto.deletionTime = user.deletionTime;
      mapExtraPropertiesTo(user, dto);
      return dto;
    });
    this.createMap(IdentityRole, IdentityRoleDto, (role) => {
      const dto = new IdentityRoleDto();
      dto.id = role.id;
      dto.name = role.name;
      dto.isDefault = role.isDefault;
      dto.isStatic = role.isStatic;
      dto.isPublic = role.isPublic;
      dto.concurrencyStamp = role.concurrencyStamp;
      dto.creationTime = role.creationTime;
      mapExtraPropertiesTo(role, dto);
      return dto;
    });
  }
}
