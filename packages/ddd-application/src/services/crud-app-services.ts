import { AbpException, type AbstractClass, type Class } from "@abp/core";
import { EntityHelper, EntityNotFoundException, isCreationAuditedEntityType, isDefaultKeyValue, type IEntity, type IQueryable, type IReadOnlyRepository, type IRepository } from "@abp/ddd-domain";
import { isMultiTenant } from "@abp/multi-tenancy-abstractions";
import { isEntityDto } from "../dtos/entity-dtos.js";
import { isLimitedResultRequest, isPagedResultRequest, isSortedResultRequest, pageBy, type PagedAndSortedResultRequestDto } from "../dtos/request-dtos.js";
import { PagedResultDto } from "../dtos/result-dtos.js";
import { AbpDynamicSortingGuard } from "./abp-dynamic-sorting-guard.js";
import { ApplicationService } from "./application-service.js";
import type { ICrudAppService, IReadOnlyAppService } from "./app-service-interfaces.js";

/**
 * The runtime classes behind the erased generic arguments: `entity` and `getOutputDto` drive the object mapper,
 * `getListOutputDto` defaults to `getOutputDto`, `createInput`/`updateInput` default to the input's own class.
 */
export interface AppServiceMapping<TEntity, TGetOutputDto, TGetListOutputDto = TGetOutputDto> {
  readonly entity: AbstractClass<TEntity>;
  readonly getOutputDto: Class<TGetOutputDto>;
  readonly getListOutputDto?: Class<TGetListOutputDto>;
  readonly createInput?: Class;
  readonly updateInput?: Class;
}

function classOf(value: object): Class {
  return value.constructor as Class;
}

/**
 * Port of `AbstractKeyReadOnlyAppService<TEntity, TGetOutputDto, TGetListOutputDto, TKey, TGetListInput>` (type
 * parameters reordered so the common cases need fewer of them). `IQueryProjector` projections are not ported.
 */
export abstract class AbstractKeyReadOnlyAppService<TEntity extends IEntity<TKey>, TGetOutputDto, TKey, TGetListInput = PagedAndSortedResultRequestDto, TGetListOutputDto = TGetOutputDto> extends ApplicationService implements IReadOnlyAppService<TGetOutputDto, TKey, TGetListInput, TGetListOutputDto> {
  protected getPolicyName: string | undefined = undefined;
  protected getListPolicyName: string | undefined = undefined;

  protected constructor(
    protected readonly readOnlyRepository: IReadOnlyRepository<TEntity, TKey>,
    protected readonly mapping: AppServiceMapping<TEntity, TGetOutputDto, TGetListOutputDto>,
  ) {
    super();
  }

  async get(id: TKey): Promise<TGetOutputDto> {
    await this.checkGetPolicy();
    const entity = await this.getEntityById(id);
    return this.mapToGetOutputDto(entity);
  }

  async getList(input: TGetListInput): Promise<PagedResultDto<TGetListOutputDto>> {
    await this.checkGetListPolicy();

    let query = await this.createFilteredQuery(input);
    const totalCount = await query.count();

    let entityDtos: TGetListOutputDto[] = [];
    if (totalCount > 0) {
      query = this.applySorting(query, input);
      query = this.applyPaging(query, input);
      entityDtos = await this.mapToGetListOutputDtos(await query.toList());
    }
    return new PagedResultDto(totalCount, entityDtos);
  }

  protected abstract getEntityById(id: TKey): Promise<TEntity>;

  protected async checkGetPolicy(): Promise<void> {
    await this.checkPolicy(this.getPolicyName);
  }

  protected async checkGetListPolicy(): Promise<void> {
    await this.checkPolicy(this.getListPolicyName);
  }

  /** Sorts by the request (guarded to the DTO's fields), or by the default when a limited result is requested. */
  protected applySorting(query: IQueryable<TEntity>, input: TGetListInput): IQueryable<TEntity> {
    if (isSortedResultRequest(input) && input.sorting !== null && input.sorting !== undefined && input.sorting.trim() !== "") {
      AbpDynamicSortingGuard.check(input.sorting, this.getSortableFields());
      return query.orderBySorting(input.sorting);
    }
    if (isLimitedResultRequest(input)) return this.applyDefaultSorting(query);
    return query;
  }

  /** The fields clients may sort by; defaults to the properties of the list DTO (undefined allows any property path). */
  protected getSortableFields(): readonly string[] | undefined {
    return AbpDynamicSortingGuard.fieldsOf((this.mapping.getListOutputDto ?? this.mapping.getOutputDto) as unknown as Class);
  }

  protected applyDefaultSorting(query: IQueryable<TEntity>): IQueryable<TEntity> {
    if (isCreationAuditedEntityType(this.mapping.entity)) return query.orderBy("creationTime", "desc");
    throw new AbpException("No sorting specified but this query requires sorting. Override the applySorting or the applyDefaultSorting method for your application service derived from AbstractKeyReadOnlyAppService!");
  }

  protected applyPaging(query: IQueryable<TEntity>, input: TGetListInput): IQueryable<TEntity> {
    if (isPagedResultRequest(input)) return pageBy(query, input);
    if (isLimitedResultRequest(input)) return query.take(input.maxResultCount);
    return query;
  }

  /** Creates the filtered (not sorted, not paged) query for `input`. */
  protected async createFilteredQuery(_input: TGetListInput): Promise<IQueryable<TEntity>> {
    return this.readOnlyRepository.getQueryable();
  }

  protected async mapToGetOutputDto(entity: TEntity): Promise<TGetOutputDto> {
    return this.objectMapper.map(this.mapping.entity as Class<TEntity>, this.mapping.getOutputDto, entity);
  }

  protected async mapToGetListOutputDtos(entities: readonly TEntity[]): Promise<TGetListOutputDto[]> {
    const dtos: TGetListOutputDto[] = [];
    for (const entity of entities) dtos.push(await this.mapToGetListOutputDto(entity));
    return dtos;
  }

  protected async mapToGetListOutputDto(entity: TEntity): Promise<TGetListOutputDto> {
    const dtoType = this.mapping.getListOutputDto;
    if (!dtoType) return (await this.mapToGetOutputDto(entity)) as unknown as TGetListOutputDto;
    return this.objectMapper.map(this.mapping.entity as Class<TEntity>, dtoType, entity);
  }
}

/** Port of `AbstractKeyCrudAppService<TEntity, TGetOutputDto, TGetListOutputDto, TKey, TGetListInput, TCreateInput, TUpdateInput>`. */
export abstract class AbstractKeyCrudAppService<TEntity extends IEntity<TKey>, TGetOutputDto, TKey, TGetListInput = PagedAndSortedResultRequestDto, TCreateInput = TGetOutputDto, TUpdateInput = TCreateInput, TGetListOutputDto = TGetOutputDto>
  extends AbstractKeyReadOnlyAppService<TEntity, TGetOutputDto, TKey, TGetListInput, TGetListOutputDto>
  implements ICrudAppService<TGetOutputDto, TKey, TGetListInput, TCreateInput, TUpdateInput, TGetListOutputDto>
{
  protected createPolicyName: string | undefined = undefined;
  protected updatePolicyName: string | undefined = undefined;
  protected deletePolicyName: string | undefined = undefined;

  protected constructor(
    protected readonly repository: IRepository<TEntity, TKey>,
    mapping: AppServiceMapping<TEntity, TGetOutputDto, TGetListOutputDto>,
  ) {
    super(repository, mapping);
  }

  async create(input: TCreateInput): Promise<TGetOutputDto> {
    await this.checkCreatePolicy();
    const entity = await this.mapToEntity(input);
    this.tryToSetTenantId(entity);
    await this.repository.insert(entity, true);
    return this.mapToGetOutputDto(entity);
  }

  async update(id: TKey, input: TUpdateInput): Promise<TGetOutputDto> {
    await this.checkUpdatePolicy();
    const entity = await this.getEntityById(id);
    await this.mapToEntityForUpdate(input, entity);
    await this.repository.update(entity, true);
    return this.mapToGetOutputDto(entity);
  }

  async delete(id: TKey): Promise<void> {
    await this.checkDeletePolicy();
    await this.deleteById(id);
  }

  protected abstract deleteById(id: TKey): Promise<void>;

  protected async checkCreatePolicy(): Promise<void> {
    await this.checkPolicy(this.createPolicyName);
  }

  protected async checkUpdatePolicy(): Promise<void> {
    await this.checkPolicy(this.updatePolicyName);
  }

  protected async checkDeletePolicy(): Promise<void> {
    await this.checkPolicy(this.deletePolicyName);
  }

  /** Port of `MapToEntityAsync(TCreateInput)`: maps through the object mapper and assigns a guid id. */
  protected async mapToEntity(createInput: TCreateInput): Promise<TEntity> {
    const sourceType = this.mapping.createInput ?? classOf(createInput as unknown as object);
    const entity = this.objectMapper.map(sourceType, this.mapping.entity as Class<TEntity>, createInput as unknown as object);
    this.setIdForGuids(entity);
    return entity;
  }

  /** Port of `SetIdForGuids`: an unset string id gets a new guid (numeric ids are left to the repository). */
  protected setIdForGuids(entity: TEntity): void {
    const id: unknown = entity.id;
    if (typeof id === "number" || typeof id === "bigint" || !isDefaultKeyValue(id)) return;
    EntityHelper.trySetId(entity as IEntity<unknown>, () => this.guidGenerator.create(), true);
  }

  /** Port of `MapToEntityAsync(TUpdateInput, TEntity)`: maps onto the existing entity. */
  protected async mapToEntityForUpdate(updateInput: TUpdateInput, entity: TEntity): Promise<void> {
    const sourceType = this.mapping.updateInput ?? classOf(updateInput as unknown as object);
    this.objectMapper.mapTo(sourceType, this.mapping.entity as Class<TEntity>, updateInput as unknown as object, entity);
  }

  /** Port of `TryToSetTenantId`: multi-tenant entities get the current tenant when one is available. */
  protected tryToSetTenantId(entity: TEntity): void {
    if (!isMultiTenant(entity)) return;
    const tenantId = this.currentTenant.id;
    if (tenantId === undefined) return;
    (entity as { tenantId?: string | null }).tenantId = tenantId;
  }
}

/** Port of `ReadOnlyAppService<TEntity, TGetOutputDto, TGetListOutputDto, TKey, TGetListInput>` over a keyed repository. */
export abstract class ReadOnlyAppService<TEntity extends IEntity<TKey>, TGetOutputDto, TKey, TGetListInput = PagedAndSortedResultRequestDto, TGetListOutputDto = TGetOutputDto> extends AbstractKeyReadOnlyAppService<TEntity, TGetOutputDto, TKey, TGetListInput, TGetListOutputDto> {
  protected constructor(
    protected readonly repository: IReadOnlyRepository<TEntity, TKey>,
    mapping: AppServiceMapping<TEntity, TGetOutputDto, TGetListOutputDto>,
  ) {
    super(repository, mapping);
  }

  protected async getEntityById(id: TKey): Promise<TEntity> {
    return this.repository.get(id);
  }

  protected override applyDefaultSorting(query: IQueryable<TEntity>): IQueryable<TEntity> {
    if (isCreationAuditedEntityType(this.mapping.entity)) return query.orderBy("creationTime", "desc");
    return query.orderBy("id", "desc");
  }
}

/**
 * Port of `CrudAppService<TEntity, TGetOutputDto, TGetListOutputDto, TKey, TGetListInput, TCreateInput, TUpdateInput>`.
 * Type parameters follow the most used .NET overload plus `TGetListOutputDto` last:
 * `CrudAppService<Book, BookDto, string>` ≡ `CrudAppService<Book, BookDto, string, PagedAndSortedResultRequestDto, BookDto, BookDto, BookDto>`.
 *
 * ```ts
 * @Transient()
 * class BookAppService extends CrudAppService<Book, BookDto, string, PagedAndSortedResultRequestDto, CreateBookDto, UpdateBookDto> {
 *   static readonly inject = [repositoryToken(Book)] as const;
 *   constructor(repository: IRepository<Book, string>) {
 *     super(repository, { entity: Book, getOutputDto: BookDto, createInput: CreateBookDto, updateInput: UpdateBookDto });
 *   }
 * }
 * ```
 */
export abstract class CrudAppService<TEntity extends IEntity<TKey>, TGetOutputDto, TKey, TGetListInput = PagedAndSortedResultRequestDto, TCreateInput = TGetOutputDto, TUpdateInput = TCreateInput, TGetListOutputDto = TGetOutputDto> extends AbstractKeyCrudAppService<TEntity, TGetOutputDto, TKey, TGetListInput, TCreateInput, TUpdateInput, TGetListOutputDto> {
  protected constructor(repository: IRepository<TEntity, TKey>, mapping: AppServiceMapping<TEntity, TGetOutputDto, TGetListOutputDto>) {
    super(repository, mapping);
  }

  protected async deleteById(id: TKey): Promise<void> {
    await this.repository.deleteById(id);
  }

  protected async getEntityById(id: TKey): Promise<TEntity> {
    const entity = await this.repository.find(id);
    if (entity === undefined) throw new EntityNotFoundException(this.mapping.entity, id);
    return entity;
  }

  /** An update input that is an entity DTO gets the entity's id before mapping (port of `MapToEntity(TUpdateInput, TEntity)`). */
  protected override async mapToEntityForUpdate(updateInput: TUpdateInput, entity: TEntity): Promise<void> {
    if (isEntityDto(updateInput)) updateInput.id = entity.id;
    await super.mapToEntityForUpdate(updateInput, entity);
  }

  protected override applyDefaultSorting(query: IQueryable<TEntity>): IQueryable<TEntity> {
    if (isCreationAuditedEntityType(this.mapping.entity)) return query.orderBy("creationTime", "desc");
    return query.orderBy("id", "desc");
  }
}
