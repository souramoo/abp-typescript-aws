/** Ports of `AbpStringExtensions` that are worth keeping in TypeScript. */
export function ensureEndsWith(value: string, suffix: string): string {
  return value.endsWith(suffix) ? value : value + suffix;
}
export function ensureStartsWith(value: string, prefix: string): string {
  return value.startsWith(prefix) ? value : prefix + value;
}
export function removePostFix(value: string, ...postFixes: string[]): string {
  for (const p of postFixes) if (p && value.endsWith(p)) return value.slice(0, -p.length);
  return value;
}
export function removePreFix(value: string, ...preFixes: string[]): string {
  for (const p of preFixes) if (p && value.startsWith(p)) return value.slice(p.length);
  return value;
}
export function isNullOrWhiteSpace(value: string | null | undefined): value is null | undefined | "" {
  return value == null || value.trim() === "";
}
export function isNullOrEmptyString(value: string | null | undefined): value is null | undefined | "" {
  return value == null || value === "";
}
export function toCamelCase(value: string): string {
  if (!value) return value;
  return value[0]!.toLowerCase() + value.slice(1);
}
export function toPascalCase(value: string): string {
  if (!value) return value;
  return value[0]!.toUpperCase() + value.slice(1);
}
export function toKebabCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1-$2")
    .replace(/[\s_]+/g, "-")
    .toLowerCase();
}
export function toSnakeCase(value: string): string {
  return toKebabCase(value).replace(/-/g, "_");
}
export function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : value.slice(0, maxLength);
}
export function truncateWithPostfix(value: string, maxLength: number, postfix = "..."): string {
  if (value.length <= maxLength) return value;
  if (maxLength <= postfix.length) return postfix.slice(0, maxLength);
  return value.slice(0, maxLength - postfix.length) + postfix;
}
/** Port of `FormattedStringValueExtracter`-lite: `"Hello {name}"` with `{ name: "x" }`. */
export function formatNamed(template: string, values: Record<string, unknown>): string {
  return template.replace(/\{(\w+)\}/g, (m, key: string) => (key in values ? String(values[key]) : m));
}
/** Port of `string.Format("{0} {1}", ...)`. */
export function formatIndexed(template: string, ...args: unknown[]): string {
  return template.replace(/\{(\d+)\}/g, (m, i: string) => {
    const v = args[Number(i)];
    return v === undefined ? m : String(v);
  });
}
export function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n|\r/g, "\n");
}
