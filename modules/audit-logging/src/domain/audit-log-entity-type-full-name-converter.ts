import { Transient } from "@abp/core";

/**
 * Port of `AuditLogEntityTypeFullNameConverter`: turns .NET generic type names (`Foo\`1[[Bar, Asm]]`) into `Foo<Bar>`.
 * Type names of this port are plain class names, so it is a pass-through for them; kept for logs written by .NET services.
 */
@Transient()
export class AuditLogEntityTypeFullNameConverter {
  convert(typeFullName: string): string {
    const genericType = /(.+?)`1\[\[/.exec(typeFullName);
    if (!genericType) return this.replaceGenericSymbol(typeFullName);

    const type = /`1\[\[(.+?), /.exec(typeFullName);
    if (!type) return typeFullName;

    const outer = genericType[1]!;
    const inner = type[1]!;
    if (inner.includes("System.Nullable`1[[")) return `${outer}<${inner.replace("System.Nullable`1[[", "")}?>`;

    return outer.includes("System.Nullable") ? `${inner}?` : `${outer}<${this.replaceGenericSymbol(inner)}>`;
  }

  protected replaceGenericSymbol(typeFullName: string): string {
    return typeFullName.includes("`1+") ? typeFullName.substring(0, typeFullName.indexOf("[[")).replace("`1+", ".") : typeFullName;
  }
}
