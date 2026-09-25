import {
  ar,
  en,
  fr,
  type CatalogShape,
  type MessageKey,
  type PluralMessage,
} from "./catalogs";
import type { Locale } from "./locale";

type StringKey = {
  [K in MessageKey]: (typeof en)[K] extends string ? K : never;
}[MessageKey];
type CountKey = Exclude<MessageKey, StringKey>;
type Parameters = Record<string, string | number>;
type Catalogs = Record<Locale, CatalogShape>;

const catalogs: Catalogs = { en, fr, ar };

/** Fall back to English if a catalog entry is missing at runtime. */
export function messageFor<K extends MessageKey>(
  locale: Locale,
  key: K,
  source: Partial<{ [L in Locale]: Partial<CatalogShape> }> = catalogs,
): CatalogShape[K] {
  const translated = source[locale]?.[key];
  return (translated ?? en[key]) as CatalogShape[K];
}

function interpolate(template: string, params: Parameters = {}) {
  return template.replace(
    /\{([a-zA-Z][a-zA-Z0-9]*)\}/g,
    (match, name: string) =>
      Object.hasOwn(params, name) ? String(params[name]) : match,
  );
}

export function translate(
  locale: Locale,
  key: StringKey,
  params?: Parameters,
): string {
  return interpolate(messageFor(locale, key) as string, params);
}

export function formatNumber(
  locale: Locale,
  value: number,
  options?: Intl.NumberFormatOptions,
) {
  return new Intl.NumberFormat(locale, options).format(value);
}

export function formatDate(
  locale: Locale,
  value: Date | number,
  options?: Intl.DateTimeFormatOptions,
) {
  return new Intl.DateTimeFormat(locale, options).format(value);
}

export function formatCount(
  locale: Locale,
  key: CountKey,
  count: number,
  params: Parameters = {},
) {
  const forms = messageFor(locale, key) as PluralMessage;
  const category = new Intl.PluralRules(locale).select(count);
  return interpolate(forms[category] ?? forms.other, {
    ...params,
    count: formatNumber(locale, count),
  });
}
