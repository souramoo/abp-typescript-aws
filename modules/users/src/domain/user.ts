import type { Guid } from "@abp/core";
import type { IAggregateRoot } from "@abp/ddd-domain";
import type { IMultiTenant } from "@abp/multi-tenancy-abstractions";
import type { IHasExtraProperties } from "@abp/object-extending";
import { UserData, type IUserData } from "../domain-shared/index.js";

/** Port of `IUser`: the aggregate root shape every user entity of an ABP application exposes. */
export interface IUser extends IAggregateRoot<Guid>, IMultiTenant, IHasExtraProperties {
  readonly userName: string;
  readonly email: string | undefined;
  readonly name: string | undefined;
  readonly surname: string | undefined;
  readonly isActive: boolean;
  readonly emailConfirmed: boolean;
  readonly phoneNumber: string | undefined;
  readonly phoneNumberConfirmed: boolean;
}

/** Port of `IUpdateUserData`: a user entity that can refresh itself from external user data; returns whether anything changed. */
export interface IUpdateUserData {
  update(user: IUserData): boolean;
}

export function isUpdateUserData(value: unknown): value is IUpdateUserData {
  return typeof value === "object" && value !== null && typeof (value as IUpdateUserData).update === "function";
}

/** Port of `AbpUserExtensions.ToAbpUserData`. */
export function toAbpUserData(user: IUser): IUserData {
  return new UserData({
    id: user.id,
    userName: user.userName,
    email: user.email,
    name: user.name,
    surname: user.surname,
    isActive: user.isActive,
    emailConfirmed: user.emailConfirmed,
    phoneNumber: user.phoneNumber,
    phoneNumberConfirmed: user.phoneNumberConfirmed,
    tenantId: user.tenantId ?? undefined,
    extraProperties: user.extraProperties,
  });
}
