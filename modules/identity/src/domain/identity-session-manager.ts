import { Transient, type Guid } from "@abp/core";
import { DomainService } from "@abp/ddd-domain";
import { IdentitySession } from "./identity-session.js";
import type { IdentityUser } from "./identity-user.js";
import { IIdentitySessionRepository } from "./repositories.js";

export interface CreateIdentitySessionInput {
  sessionId: string;
  device: string;
  deviceInfo?: string;
  clientId?: string;
  ipAddresses?: readonly string[];
}

/**
 * Port of the session bookkeeping `AbpSignInManager`/`AbpIdentityAspNetCoreModule` do on sign-in and sign-out
 * (`IdentitySession` rows keyed by the `session_id` claim). There is no `IdentitySessionManager` class in .NET;
 * the members mirror `IIdentitySessionRepository` usage of the identity module.
 */
@Transient()
export class IdentitySessionManager extends DomainService {
  static readonly inject = [IIdentitySessionRepository] as const;

  constructor(protected readonly identitySessionRepository: IIdentitySessionRepository) {
    super();
  }

  async create(user: IdentityUser, input: CreateIdentitySessionInput): Promise<IdentitySession> {
    const session = new IdentitySession({
      id: this.guidGenerator.create(),
      sessionId: input.sessionId,
      device: input.device,
      deviceInfo: input.deviceInfo,
      userId: user.id,
      tenantId: user.tenantId,
      clientId: input.clientId,
      signedIn: this.clock.now,
      lastAccessed: this.clock.now,
    });
    if (input.ipAddresses) session.setIpAddresses(input.ipAddresses);
    return this.identitySessionRepository.insert(session, true);
  }

  async find(sessionId: string): Promise<IdentitySession | undefined> {
    return this.identitySessionRepository.findBySessionId(sessionId);
  }

  async updateLastAccessed(sessionId: string, ipAddress?: string): Promise<void> {
    const session = await this.identitySessionRepository.findBySessionId(sessionId);
    if (!session) return;
    session.updateLastAccessedTime(this.clock.now);
    if (ipAddress !== undefined && !session.getIpAddresses().includes(ipAddress)) session.setIpAddresses([...session.getIpAddresses(), ipAddress]);
    await this.identitySessionRepository.update(session, true);
  }

  async revoke(sessionId: string): Promise<void> {
    const session = await this.identitySessionRepository.findBySessionId(sessionId);
    if (session) await this.identitySessionRepository.delete(session, true);
  }

  async revokeAll(userId: Guid, device?: string, exceptSessionId?: Guid): Promise<void> {
    if (device === undefined) await this.identitySessionRepository.deleteAllOfUser(userId, exceptSessionId);
    else await this.identitySessionRepository.deleteAllOfUserDevice(userId, device, exceptSessionId);
  }
}
