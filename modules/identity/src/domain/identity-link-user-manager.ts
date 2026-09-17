import { Transient } from "@abp/core";
import { DomainService } from "@abp/ddd-domain";
import { UnitOfWork } from "@abp/uow";
import { LinkUserTokenProviderConsts } from "../domain-shared/index.js";
import type { IdentityLinkUserInfo } from "./identity-link-user.js";
import { IdentityLinkUser } from "./identity-link-user.js";
import { IdentityUserManager } from "./identity-user-manager.js";
import { IIdentityLinkUserRepository } from "./repositories.js";

/** Port of `IdentityLinkUserManager`: links between user accounts (stored on the host side) and the link tokens/consents. */
@Transient()
export class IdentityLinkUserManager extends DomainService {
  static readonly inject = [IIdentityLinkUserRepository, IdentityUserManager] as const;

  constructor(
    protected readonly identityLinkUserRepository: IIdentityLinkUserRepository,
    protected readonly userManager: IdentityUserManager,
  ) {
    super();
  }

  async getList(linkUserInfo: IdentityLinkUserInfo, includeIndirect = false, batchSize = 100 * 100): Promise<IdentityLinkUser[]> {
    return this.currentTenant.run(undefined, undefined, async () => {
      const users = await this.identityLinkUserRepository.getListOf(linkUserInfo);
      if (!includeIndirect) return users;
      const allUsers = await this.identityLinkUserRepository.getAllInBatches(batchSize);
      return this.getAllRelatedLinks(allUsers, linkUserInfo);
    });
  }

  /** Breadth-first walk over every link reachable from `userInfo`. */
  protected getAllRelatedLinks(allUsers: readonly IdentityLinkUser[], userInfo: IdentityLinkUserInfo): IdentityLinkUser[] {
    const key = (info: IdentityLinkUserInfo) => `${info.userId}|${info.tenantId ?? ""}`;
    const visited = new Set<string>([key(userInfo)]);
    const result: IdentityLinkUser[] = [];
    const queue: IdentityLinkUserInfo[] = [userInfo];
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const link of allUsers.filter((x) => x.involves(current))) {
        if (!result.includes(link)) result.push(link);
        for (const node of [link.source, link.target]) {
          if (visited.has(key(node))) continue;
          visited.add(key(node));
          queue.push(node);
        }
      }
    }
    return result;
  }

  async link(sourceLinkUser: IdentityLinkUserInfo, targetLinkUser: IdentityLinkUserInfo): Promise<void> {
    await this.currentTenant.run(undefined, undefined, async () => {
      if (sourceLinkUser.equals(targetLinkUser)) return;
      if (await this.isLinked(sourceLinkUser, targetLinkUser)) return;
      await this.identityLinkUserRepository.insert(new IdentityLinkUser(this.guidGenerator.create(), sourceLinkUser, targetLinkUser), true);
    });
  }

  async isLinked(sourceLinkUser: IdentityLinkUserInfo, targetLinkUser: IdentityLinkUserInfo, includeIndirect = false): Promise<boolean> {
    return this.currentTenant.run(undefined, undefined, async () => {
      if (includeIndirect) return (await this.getList(sourceLinkUser, true)).some((x) => x.involves(targetLinkUser));
      return (await this.identityLinkUserRepository.findLink(sourceLinkUser, targetLinkUser)) !== undefined;
    });
  }

  async unlink(sourceLinkUser: IdentityLinkUserInfo, targetLinkUser: IdentityLinkUserInfo): Promise<void> {
    await this.currentTenant.run(undefined, undefined, async () => {
      const linkedUser = await this.identityLinkUserRepository.findLink(sourceLinkUser, targetLinkUser);
      if (linkedUser) await this.identityLinkUserRepository.delete(linkedUser);
    });
  }

  async generateLinkToken(targetLinkUser: IdentityLinkUserInfo, tokenPurpose: string): Promise<string> {
    return this.currentTenant.run(targetLinkUser.tenantId, undefined, async () => {
      const user = await this.userManager.getById(targetLinkUser.userId);
      return this.userManager.generateUserToken(user, LinkUserTokenProviderConsts.linkUserTokenProviderName, tokenPurpose);
    });
  }

  async verifyLinkToken(targetLinkUser: IdentityLinkUserInfo, token: string, tokenPurpose: string): Promise<boolean> {
    return this.currentTenant.run(targetLinkUser.tenantId, undefined, async () => {
      const user = await this.userManager.getById(targetLinkUser.userId);
      return this.userManager.verifyUserToken(user, LinkUserTokenProviderConsts.linkUserTokenProviderName, tokenPurpose, token);
    });
  }

  @UnitOfWork()
  async setLinkConsent(sourceLinkUser: IdentityLinkUserInfo, consent: string): Promise<void> {
    await this.currentTenant.run(sourceLinkUser.tenantId, undefined, async () => {
      const user = await this.userManager.findById(sourceLinkUser.userId);
      if (!user) return;
      (await this.userManager.setAuthenticationToken(user, LinkUserTokenProviderConsts.linkUserConsentLoginProvider, LinkUserTokenProviderConsts.linkUserConsentTokenName, consent)).checkErrors();
    });
  }

  @UnitOfWork()
  async getLinkConsent(sourceLinkUser: IdentityLinkUserInfo): Promise<string | undefined> {
    return this.currentTenant.run(sourceLinkUser.tenantId, undefined, async () => {
      const user = await this.userManager.findById(sourceLinkUser.userId);
      if (!user) return undefined;
      return this.userManager.getAuthenticationToken(user, LinkUserTokenProviderConsts.linkUserConsentLoginProvider, LinkUserTokenProviderConsts.linkUserConsentTokenName);
    });
  }

  @UnitOfWork()
  async removeLinkConsent(sourceLinkUser: IdentityLinkUserInfo): Promise<void> {
    await this.currentTenant.run(sourceLinkUser.tenantId, undefined, async () => {
      const user = await this.userManager.findById(sourceLinkUser.userId);
      if (!user) return;
      (await this.userManager.removeAuthenticationToken(user, LinkUserTokenProviderConsts.linkUserConsentLoginProvider, LinkUserTokenProviderConsts.linkUserConsentTokenName)).checkErrors();
    });
  }
}
