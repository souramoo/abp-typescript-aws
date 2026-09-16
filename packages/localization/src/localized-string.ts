import type { LocalizedString } from "@abp/core";

export function createLocalizedString(name: string, value: string, resourceNotFound = false): LocalizedString {
  return { name, value, resourceNotFound };
}

export function notFoundString(name: string): LocalizedString {
  return { name, value: name, resourceNotFound: true };
}
