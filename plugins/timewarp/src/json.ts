import type { JsonObject } from "./types.ts";

export function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function textFromContent(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (const item of value) {
      if (isObject(item)) {
        const text = item.text;
        if (typeof text === "string") {
          parts.push(text);
        }
      } else if (typeof item === "string") {
        parts.push(item);
      }
    }
    return parts.length > 0 ? parts.join("\n") : undefined;
  }

  return undefined;
}

export function stableStringify(value: unknown): string {
  if (value === undefined) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function truncate(value: string, maxLength = 120): string {
  const singleLine = value.replace(/\s+/g, " ").trim();
  if (singleLine.length <= maxLength) {
    return singleLine;
  }
  return `${singleLine.slice(0, Math.max(0, maxLength - 3))}...`;
}
