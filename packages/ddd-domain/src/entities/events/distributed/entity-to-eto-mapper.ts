import { Check, IRootServiceProvider, Transient, createToken, optionsToken, type Class, type IOptions, type IServiceProvider } from "@abp/core";
import { IObjectMapper, objectMapperToken } from "@abp/object-mapping";
import { isMultiTenant } from "@abp/multi-tenancy-abstractions";
import { isEntity, isEntityWithId } from "../../entity.js";
import { AbpDistributedEntityEventOptions, EntityEto } from "./etos.js";

/** Port of `IEntityToEtoMapper`. */
export interface IEntityToEtoMapper {
  /** Returns the ETO of the entity, or undefined when the object is not an entity. */
  map(entityObj: object): object | undefined;
}
export const IEntityToEtoMapper = createToken<IEntityToEtoMapper>("IEntityToEtoMapper");

/**
 * Port of `EntityToEtoMapper`. Without a configured mapping the entity becomes an {@link EntityEto} that carries the
 * entity class name, its keys and (when present) `id` and `tenantId`.
 */
@Transient(IEntityToEtoMapper)
export class EntityToEtoMapper implements IEntityToEtoMapper {
  static readonly inject = [optionsToken(AbpDistributedEntityEventOptions), IRootServiceProvider] as const;
  protected readonly options: AbpDistributedEntityEventOptions;

  constructor(
    options: IOptions<AbpDistributedEntityEventOptions>,
    protected readonly rootServiceProvider: IServiceProvider,
  ) {
    this.options = options.value;
  }

  map(entityObj: object): object | undefined {
    Check.notNull(entityObj, "entityObj");
    if (!isEntity(entityObj)) return undefined;

    const entityType = entityObj.constructor as Class;
    const etoMappingItem = this.options.etoMappings.get(entityType);
    if (!etoMappingItem) {
      const eto = new EntityEto(entityType.name, entityObj.getKeys().join(","));
      if (isEntityWithId(entityObj)) eto.id = entityObj.id;
      if (isMultiTenant(entityObj)) eto.tenantId = entityObj.tenantId ?? undefined;
      return eto;
    }

    const scope = this.rootServiceProvider.createScope();
    try {
      const objectMapper = scope.serviceProvider.getRequired(etoMappingItem.objectMappingContextType ? objectMapperToken(etoMappingItem.objectMappingContextType) : IObjectMapper);
      return objectMapper.map(entityType, etoMappingItem.etoType, entityObj) as object;
    } finally {
      void scope.dispose();
    }
  }
}
