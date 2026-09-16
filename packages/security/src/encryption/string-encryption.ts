import { createCipheriv, createDecipheriv, pbkdf2Sync } from "node:crypto";
import { Transient, createToken, optionsToken, type IOptions } from "@abp/core";

/** Port of `AbpStringEncryptionOptions`. Defaults are byte-compatible with ABP's. */
export class AbpStringEncryptionOptions {
  /** Key size in bits: 128, 192 or 256. Default: 256. */
  keySize = 256;
  defaultPassPhrase = "gsKnGZ041HLL4IM8";
  /** AES block IV: must be 16 bytes. */
  initVectorBytes: Uint8Array = Buffer.from("jkE49230Tf093b42", "ascii");
  defaultSalt: Uint8Array = Buffer.from("hgt!16kl", "ascii");
}

/** Port of `IStringEncryptionService`. */
export interface IStringEncryptionService {
  encrypt(plainText: string | null | undefined, passPhrase?: string, salt?: Uint8Array): string | undefined;
  decrypt(cipherText: string | null | undefined, passPhrase?: string, salt?: Uint8Array): string | undefined;
}
export const IStringEncryptionService = createToken<IStringEncryptionService>("IStringEncryptionService");

/**
 * Port of `StringEncryptionService`: AES-CBC with a PBKDF2 (1000 iterations, SHA-1, like
 * `Rfc2898DeriveBytes(passPhrase, salt)`) derived key and base64 output, interoperable with .NET ABP.
 */
@Transient(IStringEncryptionService)
export class StringEncryptionService implements IStringEncryptionService {
  static readonly inject = [optionsToken(AbpStringEncryptionOptions)] as const;
  protected readonly options: AbpStringEncryptionOptions;

  constructor(options: IOptions<AbpStringEncryptionOptions>) {
    this.options = options.value;
  }

  encrypt(plainText: string | null | undefined, passPhrase?: string, salt?: Uint8Array): string | undefined {
    if (plainText === null || plainText === undefined) return undefined;
    const cipher = createCipheriv(this.algorithm, this.deriveKey(passPhrase, salt), this.options.initVectorBytes);
    return Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]).toString("base64");
  }

  decrypt(cipherText: string | null | undefined, passPhrase?: string, salt?: Uint8Array): string | undefined {
    if (cipherText === null || cipherText === undefined || cipherText === "") return undefined;
    const decipher = createDecipheriv(this.algorithm, this.deriveKey(passPhrase, salt), this.options.initVectorBytes);
    return Buffer.concat([decipher.update(Buffer.from(cipherText, "base64")), decipher.final()]).toString("utf8");
  }

  private get algorithm(): string {
    return `aes-${this.options.keySize}-cbc`;
  }

  private deriveKey(passPhrase: string | undefined, salt: Uint8Array | undefined): Buffer {
    return pbkdf2Sync(passPhrase ?? this.options.defaultPassPhrase, salt ?? this.options.defaultSalt, 1000, this.options.keySize / 8, "sha1");
  }
}
