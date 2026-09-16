import type { Guid } from "@abp/core";
import { ExtraPropertyDictionary, type IHasExtraProperties } from "@abp/object-extending";

/** Port of `IUserData`. */
export interface IUserData extends IHasExtraProperties {
  readonly id: Guid;
  readonly tenantId: Guid | undefined;
  readonly userName: string;
  readonly name: string | undefined;
  readonly surname: string | undefined;
  readonly isActive: boolean;
  readonly email: string | undefined;
  readonly emailConfirmed: boolean;
  readonly phoneNumber: string | undefined;
  readonly phoneNumberConfirmed: boolean;
}

export interface UserDataInit {
  id: Guid;
  userName: string;
  email?: string;
  name?: string;
  surname?: string;
  emailConfirmed?: boolean;
  phoneNumber?: string;
  phoneNumberConfirmed?: boolean;
  tenantId?: Guid;
  isActive?: boolean;
  extraProperties?: ExtraPropertyDictionary;
}

/** Port of `UserData`: a detached copy of an `IUserData` (the .NET copy constructor is `UserData.from`). */
export class UserData implements IUserData {
  id: Guid;
  tenantId: Guid | undefined;
  userName: string;
  name: string | undefined;
  surname: string | undefined;
  isActive: boolean;
  email: string | undefined;
  emailConfirmed: boolean;
  phoneNumber: string | undefined;
  phoneNumberConfirmed: boolean;
  extraProperties: ExtraPropertyDictionary;

  constructor(init: UserDataInit) {
    this.id = init.id;
    this.userName = init.userName;
    this.email = init.email;
    this.name = init.name;
    this.surname = init.surname;
    this.isActive = init.isActive ?? true;
    this.emailConfirmed = init.emailConfirmed ?? false;
    this.phoneNumber = init.phoneNumber;
    this.phoneNumberConfirmed = init.phoneNumberConfirmed ?? false;
    this.tenantId = init.tenantId;
    this.extraProperties = init.extraProperties ?? new ExtraPropertyDictionary();
  }

  static from(userData: IUserData): UserData {
    return new UserData({
      id: userData.id,
      userName: userData.userName,
      email: userData.email,
      name: userData.name,
      surname: userData.surname,
      isActive: userData.isActive,
      emailConfirmed: userData.emailConfirmed,
      phoneNumber: userData.phoneNumber,
      phoneNumberConfirmed: userData.phoneNumberConfirmed,
      tenantId: userData.tenantId,
      extraProperties: userData.extraProperties,
    });
  }
}

/** Port of `IRoleData`. */
export interface IRoleData extends IHasExtraProperties {
  readonly id: Guid;
  readonly tenantId: Guid | undefined;
  readonly name: string;
  readonly isDefault: boolean;
  readonly isStatic: boolean;
  readonly isPublic: boolean;
}

export interface RoleDataInit {
  id: Guid;
  name: string;
  isDefault?: boolean;
  isStatic?: boolean;
  isPublic?: boolean;
  tenantId?: Guid;
  extraProperties?: ExtraPropertyDictionary;
}

/** Port of `RoleData`. */
export class RoleData implements IRoleData {
  id: Guid;
  tenantId: Guid | undefined;
  name: string;
  isDefault: boolean;
  isStatic: boolean;
  isPublic: boolean;
  extraProperties: ExtraPropertyDictionary;

  constructor(init: RoleDataInit) {
    this.id = init.id;
    this.name = init.name;
    this.isDefault = init.isDefault ?? false;
    this.isStatic = init.isStatic ?? false;
    this.isPublic = init.isPublic ?? false;
    this.tenantId = init.tenantId;
    this.extraProperties = init.extraProperties ?? new ExtraPropertyDictionary();
  }

  static from(roleData: IRoleData): RoleData {
    return new RoleData({ id: roleData.id, name: roleData.name, isDefault: roleData.isDefault, isStatic: roleData.isStatic, isPublic: roleData.isPublic, tenantId: roleData.tenantId, extraProperties: roleData.extraProperties });
  }
}
