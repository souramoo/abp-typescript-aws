import { createToken, Transient } from "@abp/core";
import { pbkdf2Sync, randomBytes, timingSafeEqual } from "node:crypto";
import type { IdentityUser } from "./identity-user.js";

/** Port of `Microsoft.AspNetCore.Identity.PasswordVerificationResult`. */
export enum PasswordVerificationResult {
  Failed = 0,
  Success = 1,
  SuccessRehashNeeded = 2,
}

/** Port of `IPasswordHasher<IdentityUser>`. */
export interface IPasswordHasher {
  hashPassword(user: IdentityUser, password: string): string;
  verifyHashedPassword(user: IdentityUser, hashedPassword: string, providedPassword: string): PasswordVerificationResult;
}
export const IPasswordHasher = createToken<IPasswordHasher>("IPasswordHasher");

/** Port of `PasswordHasherOptions` (v3 only: PBKDF2-HMAC-SHA512, 100,000 iterations). */
export class PasswordHasherOptions {
  iterationCount = 100_000;
}

type Prf = "sha1" | "sha256" | "sha512";
const prfByCode: readonly Prf[] = ["sha1", "sha256", "sha512"];
const SaltSize = 128 / 8;
const SubkeySize = 256 / 8;

/**
 * Port of `PasswordHasher<TUser>` in `IdentityV3` compatibility mode, byte-compatible with ASP.NET Core:
 * `0x01 | prf (uint32) | iterations (uint32) | salt length (uint32) | salt | subkey`, base64 encoded, so hashes
 * migrated from a .NET database verify (any PRF/iteration count/salt length is accepted, like .NET). Hashes are
 * produced with PBKDF2-HMAC-SHA512, 100k iterations, a 16-byte salt and a 32-byte subkey. The V2 format
 * (`0x00` marker) is verified too and reported as `SuccessRehashNeeded`.
 */
@Transient(IPasswordHasher)
export class Pbkdf2PasswordHasher implements IPasswordHasher {
  private readonly iterationCount: number;

  constructor(options?: PasswordHasherOptions) {
    this.iterationCount = options?.iterationCount ?? new PasswordHasherOptions().iterationCount;
    if (this.iterationCount < 1) throw new RangeError("The iteration count must be a positive integer.");
  }

  hashPassword(_user: IdentityUser, password: string): string {
    if (password === undefined || password === null) throw new TypeError("password can not be null.");
    return Buffer.from(hashPasswordV3(password, this.iterationCount)).toString("base64");
  }

  verifyHashedPassword(_user: IdentityUser, hashedPassword: string, providedPassword: string): PasswordVerificationResult {
    if (hashedPassword === undefined || hashedPassword === null) throw new TypeError("hashedPassword can not be null.");
    if (providedPassword === undefined || providedPassword === null) throw new TypeError("providedPassword can not be null.");

    const decoded = Buffer.from(hashedPassword, "base64");
    if (decoded.length === 0) return PasswordVerificationResult.Failed;

    switch (decoded[0]) {
      case 0x00:
        return verifyHashedPasswordV2(decoded, providedPassword) ? PasswordVerificationResult.SuccessRehashNeeded : PasswordVerificationResult.Failed;
      case 0x01: {
        const embedded = verifyHashedPasswordV3(decoded, providedPassword);
        if (!embedded.verified) return PasswordVerificationResult.Failed;
        return embedded.iterationCount < this.iterationCount ? PasswordVerificationResult.SuccessRehashNeeded : PasswordVerificationResult.Success;
      }
      default:
        return PasswordVerificationResult.Failed;
    }
  }
}

function hashPasswordV3(password: string, iterationCount: number): Uint8Array {
  const salt = randomBytes(SaltSize);
  const subkey = pbkdf2Sync(password, salt, iterationCount, SubkeySize, "sha512");
  const output = Buffer.alloc(13 + salt.length + subkey.length);
  output[0] = 0x01;
  output.writeUInt32BE(2, 1);
  output.writeUInt32BE(iterationCount, 5);
  output.writeUInt32BE(salt.length, 9);
  salt.copy(output, 13);
  subkey.copy(output, 13 + salt.length);
  return output;
}

function verifyHashedPasswordV3(hashedPassword: Buffer, password: string): { verified: boolean; iterationCount: number } {
  try {
    const prfCode = hashedPassword.readUInt32BE(1);
    const iterationCount = hashedPassword.readUInt32BE(5);
    const saltLength = hashedPassword.readUInt32BE(9);
    const prf = prfByCode[prfCode];
    if (!prf || saltLength < SaltSize) return { verified: false, iterationCount };
    const salt = hashedPassword.subarray(13, 13 + saltLength);
    const subkeyLength = hashedPassword.length - 13 - saltLength;
    if (subkeyLength < SaltSize) return { verified: false, iterationCount };
    const expectedSubkey = hashedPassword.subarray(13 + saltLength);
    const actualSubkey = pbkdf2Sync(password, salt, iterationCount, subkeyLength, prf);
    return { verified: timingSafeEqual(actualSubkey, expectedSubkey), iterationCount };
  } catch {
    return { verified: false, iterationCount: 0 };
  }
}

/** V2: PBKDF2-HMAC-SHA1, 1000 iterations, 16-byte salt, 32-byte subkey. */
function verifyHashedPasswordV2(hashedPassword: Buffer, password: string): boolean {
  if (hashedPassword.length !== 1 + SaltSize + SubkeySize) return false;
  const salt = hashedPassword.subarray(1, 1 + SaltSize);
  const expectedSubkey = hashedPassword.subarray(1 + SaltSize);
  const actualSubkey = pbkdf2Sync(password, salt, 1000, SubkeySize, "sha1");
  return timingSafeEqual(actualSubkey, expectedSubkey);
}
