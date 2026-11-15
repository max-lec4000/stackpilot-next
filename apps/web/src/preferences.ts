import { useState, type Dispatch, type SetStateAction } from "react";

// Only explicit non-secret view preferences; never arbitrary form state.
export function usePreference<T>(key: string, fallback: T, valid: (value: unknown) => value is T): [T, Dispatch<SetStateAction<T>>] {
  const [value, update] = useState<T>(() => {
    try {
      const parsed: unknown = JSON.parse(localStorage.getItem("stackpilot-view:" + key) || "null");
      return valid(parsed) ? parsed : fallback;
    } catch { return fallback; }
  });
  const setValue: Dispatch<SetStateAction<T>> = (next) => {
    update((previous) => {
      const result = typeof next === "function" ? (next as (old: T) => T)(previous) : next;
      if (!valid(result)) return previous;
      try { localStorage.setItem("stackpilot-view:" + key, JSON.stringify(result)); } catch {}
      return result;
    });
  };
  return [value, setValue];
}
export const oneOf = <T extends string>(...values: T[]) => (value: unknown): value is T => typeof value === "string" && values.includes(value as T);
