import { Transient } from "@abp/core";
import { UserPermissionValueProvider } from "@abp/authorization";
import { EntityDeletedEto } from "@abp/ddd-domain";
import { DistributedEventHandler, type IDistributedEventHandler } from "@abp/event-bus";
import { UnitOfWork } from "@abp/uow";
import { UserEto } from "@abp/users/domain-shared";
import { IPermissionManager } from "../permission-manager.js";

/** Port of `UserDeletedEventHandler` (`Volo.Abp.PermissionManagement.Domain.Identity`): removes the grants of a deleted user. */
@Transient()
@DistributedEventHandler(EntityDeletedEto.of(UserEto))
export class UserDeletedEventHandler implements IDistributedEventHandler<EntityDeletedEto<UserEto>> {
  static readonly inject = [IPermissionManager] as const;

  constructor(protected readonly permissionManager: IPermissionManager) {}

  @UnitOfWork()
  async handleEvent(eventData: EntityDeletedEto<UserEto>): Promise<void> {
    await this.permissionManager.delete(UserPermissionValueProvider.ProviderName, eventData.entity.id);
  }
}
