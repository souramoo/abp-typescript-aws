import type { Guid } from "@abp/core";
import { AuditedAggregateRoot } from "@abp/ddd-domain";
import type { IMultiTenant } from "@abp/multi-tenancy-abstractions";

/** Port of the `BookType` enum of the ABP "Web Application Development" tutorial. */
export enum BookType {
  Undefined = 0,
  Adventure = 1,
  Biography = 2,
  Dystopia = 3,
  Fantasy = 4,
  Horror = 5,
  Science = 6,
  ScienceFiction = 7,
  Poetry = 8,
}

/** Port of the tutorial's `Book` aggregate root; tenant-aware so the sample also proves data isolation. */
export class Book extends AuditedAggregateRoot<Guid> implements IMultiTenant {
  name: string;
  type: BookType;
  publishDate: Date;
  price: number;
  tenantId: Guid | null = null;

  constructor(id: Guid, name: string, type: BookType, publishDate: Date, price: number, tenantId: Guid | null = null) {
    super(id);
    this.name = name;
    this.type = type;
    this.publishDate = publishDate;
    this.price = price;
    this.tenantId = tenantId;
  }
}
