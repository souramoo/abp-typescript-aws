import { Transient } from "@abp/core";
import { ICurrentTenant, IMultiTenantUrlProvider, ITenantStore } from "@abp/multi-tenancy-abstractions";

/** Port of `MultiTenantUrlProvider`: replaces `{{tenantId}}`, `{{tenantName}}` and `{0}` placeholders in URL templates. */
@Transient(IMultiTenantUrlProvider)
export class MultiTenantUrlProvider implements IMultiTenantUrlProvider {
  static readonly inject = [ICurrentTenant, ITenantStore] as const;
  static readonly TenantPlaceHolder = "{0}";
  static readonly TenantIdPlaceHolder = "{{tenantId}}";
  static readonly TenantNamePlaceHolder = "{{tenantName}}";

  constructor(
    protected readonly currentTenant: ICurrentTenant,
    protected readonly tenantStore: ITenantStore,
  ) {}

  async getUrl(templateUrl: string): Promise<string> {
    let url = await this.replacePlaceHolder(templateUrl, MultiTenantUrlProvider.TenantIdPlaceHolder);
    url = await this.replacePlaceHolder(url, MultiTenantUrlProvider.TenantNamePlaceHolder);
    return this.replacePlaceHolder(url, MultiTenantUrlProvider.TenantPlaceHolder);
  }

  protected async replacePlaceHolder(templateUrl: string, placeHolder: string): Promise<string> {
    if (!templateUrl.includes(placeHolder)) return templateUrl;

    let placeHolderValue = "";
    if (this.currentTenant.isAvailable) {
      placeHolderValue = (placeHolder === MultiTenantUrlProvider.TenantIdPlaceHolder ? this.currentTenant.id! : await this.getCurrentTenantName()) + ".";
    }
    if (templateUrl.includes(placeHolder + ".")) placeHolder += ".";
    return templateUrl.replaceAll(placeHolder, placeHolderValue);
  }

  protected async getCurrentTenantName(): Promise<string> {
    if (this.currentTenant.id !== undefined && !this.currentTenant.name) {
      const tenant = await this.tenantStore.findById(this.currentTenant.id);
      return tenant?.name ?? "";
    }
    return this.currentTenant.name ?? "";
  }
}
