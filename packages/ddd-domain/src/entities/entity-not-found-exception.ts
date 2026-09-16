import { AbpException, type AbstractClass } from "@abp/core";

/** Port of `EntityNotFoundException` / `EntityNotFoundException<TEntity>`. */
export class EntityNotFoundException extends AbpException {
  readonly entityType: AbstractClass | undefined;
  readonly id: unknown;

  constructor(entityType?: AbstractClass, id?: unknown, options?: { message?: string; cause?: unknown }) {
    super(options?.message ?? createMessage(entityType, id), { cause: options?.cause });
    this.entityType = entityType;
    this.id = id;
  }
}

function createMessage(entityType: AbstractClass | undefined, id: unknown): string {
  if (!entityType) return "There is no such an entity!";
  if (id === undefined || id === null) return `There is no such an entity given given id. Entity type: ${entityType.name}`;
  return `There is no such an entity. Entity type: ${entityType.name}, id: ${String(id)}`;
}
