import type { Guid } from "@abp/core";
import { AggregateRoot } from "@abp/ddd-domain";
import type { IUser, IUpdateUserData } from "../src/domain/index.js";
import type { IUserData } from "../src/domain-shared/index.js";

/** A minimal `IUser` aggregate for the users tests (the real one is `IdentityUser` of the identity module). */
export class TestUser extends AggregateRoot<Guid> implements IUser, IUpdateUserData {
  tenantId: Guid | undefined = undefined;
  userName = "";
  email: string | undefined = undefined;
  name: string | undefined = undefined;
  surname: string | undefined = undefined;
  isActive = true;
  emailConfirmed = false;
  phoneNumber: string | undefined = undefined;
  phoneNumberConfirmed = false;

  constructor(id?: Guid, userName = "", email?: string, name?: string, surname?: string) {
    super(id);
    this.userName = userName;
    this.email = email;
    this.name = name;
    this.surname = surname;
  }

  static fromUserData(user: IUserData): TestUser {
    const created = new TestUser(user.id, user.userName, user.email, user.name, user.surname);
    created.tenantId = user.tenantId;
    created.isActive = user.isActive;
    created.emailConfirmed = user.emailConfirmed;
    created.phoneNumber = user.phoneNumber;
    created.phoneNumberConfirmed = user.phoneNumberConfirmed;
    return created;
  }

  update(user: IUserData): boolean {
    const next = { userName: user.userName, email: user.email, name: user.name, surname: user.surname, isActive: user.isActive, emailConfirmed: user.emailConfirmed, phoneNumber: user.phoneNumber, phoneNumberConfirmed: user.phoneNumberConfirmed };
    const changed = Object.entries(next).some(([key, value]) => this[key as keyof typeof next] !== value);
    if (changed) Object.assign(this, next);
    return changed;
  }
}
