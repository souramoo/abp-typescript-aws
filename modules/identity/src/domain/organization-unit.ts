import { ArgumentNullException, Check, isNullOrEmptyString, removeAll, type Guid } from "@abp/core";
import { EntityBase, FullAuditedAggregateRoot } from "@abp/ddd-domain";
import type { IMultiTenant } from "@abp/multi-tenancy-abstractions";
import { OrganizationUnitConsts } from "../domain-shared/index.js";

/** Port of `OrganizationUnitRole` (composite key: organizationUnitId + roleId). */
export class OrganizationUnitRole extends EntityBase implements IMultiTenant {
  tenantId: Guid | undefined = undefined;
  roleId!: Guid;
  organizationUnitId!: Guid;
  creationTime!: Date;
  creatorId: Guid | undefined = undefined;

  constructor(roleId?: Guid, organizationUnitId?: Guid, tenantId?: Guid) {
    super();
    if (roleId === undefined) return;
    this.roleId = roleId;
    this.organizationUnitId = Check.notNull(organizationUnitId, "organizationUnitId");
    this.tenantId = tenantId;
    this.creationTime = new Date();
  }

  getKeys(): readonly unknown[] {
    return [this.organizationUnitId, this.roleId];
  }
}

/** Port of `OrganizationUnit`: a node of the OU tree addressed by its hierarchical `code` (`00001.00002`). */
export class OrganizationUnit extends FullAuditedAggregateRoot<Guid> implements IMultiTenant {
  tenantId: Guid | undefined = undefined;
  parentId: Guid | undefined = undefined;
  code!: string;
  displayName!: string;
  entityVersion = 0;
  roles: OrganizationUnitRole[] = [];

  constructor(id?: Guid, displayName?: string, parentId?: Guid, tenantId?: Guid) {
    super(id);
    if (id === undefined) return;
    this.tenantId = tenantId;
    this.displayName = Check.notNull(displayName, "displayName");
    this.parentId = parentId;
  }

  /** Port of `CreateCode`: `createCode(1, 2)` → `"00001.00002"`. */
  static createCode(...numbers: number[]): string | undefined {
    if (numbers.length === 0) return undefined;
    return numbers.map((number) => String(number).padStart(OrganizationUnitConsts.CodeUnitLength, "0")).join(".");
  }

  static appendCode(parentCode: string | undefined, childCode: string | undefined): string {
    if (isNullOrEmptyString(childCode)) throw new ArgumentNullException("childCode");
    if (isNullOrEmptyString(parentCode)) return childCode;
    return `${parentCode}.${childCode}`;
  }

  static getRelativeCode(code: string | undefined, parentCode: string | undefined): string | undefined {
    if (isNullOrEmptyString(code)) throw new ArgumentNullException("code");
    if (isNullOrEmptyString(parentCode)) return code;
    if (code.length === parentCode.length) return undefined;
    return code.slice(parentCode.length + 1);
  }

  static calculateNextCode(code: string | undefined): string {
    if (isNullOrEmptyString(code)) throw new ArgumentNullException("code");
    const parentCode = OrganizationUnit.getParentCode(code);
    const lastUnitCode = OrganizationUnit.getLastUnitCode(code);
    return OrganizationUnit.appendCode(parentCode, OrganizationUnit.createCode(Number.parseInt(lastUnitCode, 10) + 1));
  }

  static getLastUnitCode(code: string | undefined): string {
    if (isNullOrEmptyString(code)) throw new ArgumentNullException("code");
    const parts = code.split(".");
    return parts[parts.length - 1]!;
  }

  static getParentCode(code: string | undefined): string | undefined {
    if (isNullOrEmptyString(code)) throw new ArgumentNullException("code");
    const parts = code.split(".");
    if (parts.length === 1) return undefined;
    return parts.slice(0, -1).join(".");
  }

  addRole(roleId: Guid): void {
    Check.notNull(roleId, "roleId");
    if (this.isInRole(roleId)) return;
    this.roles.push(new OrganizationUnitRole(roleId, this.id, this.tenantId));
  }

  removeRole(roleId: Guid): void {
    Check.notNull(roleId, "roleId");
    if (!this.isInRole(roleId)) return;
    removeAll(this.roles, (r) => r.roleId === roleId);
  }

  isInRole(roleId: Guid): boolean {
    Check.notNull(roleId, "roleId");
    return this.roles.some((r) => r.roleId === roleId);
  }
}
