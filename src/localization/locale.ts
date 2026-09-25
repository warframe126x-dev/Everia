export const locales = ["en", "fr", "ar"] as const;
export type Locale = (typeof locales)[number];

export function isLocale(value: unknown): value is Locale {
  return (
    typeof value === "string" && locales.some((locale) => locale === value)
  );
}
