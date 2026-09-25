import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { storage } from "../storage";
import type { Locale } from "./locale";
import { formatCount, formatDate, formatNumber, translate } from "./format";

type Localization = {
  locale: Locale;
  direction: "ltr" | "rtl";
  setLocale: (next: Locale) => void;
  t: typeof translate extends (locale: Locale, ...args: infer A) => string
    ? (...args: A) => string
    : never;
  count: typeof formatCount extends (locale: Locale, ...args: infer A) => string
    ? (...args: A) => string
    : never;
  number: (value: number, options?: Intl.NumberFormatOptions) => string;
  date: (value: Date | number, options?: Intl.DateTimeFormatOptions) => string;
};

const Context = createContext<Localization | null>(null);

export function LocalizationProvider({
  children,
  initialLocale,
}: {
  children: ReactNode;
  initialLocale?: Locale;
}) {
  const [locale, updateLocale] = useState<Locale>(
    () => initialLocale ?? storage.loadLocale(),
  );
  useLayoutEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = locale === "ar" ? "rtl" : "ltr";
  }, [locale]);
  const setLocale = useCallback((next: Locale) => {
    storage.saveLocale(next);
    updateLocale(next);
  }, []);
  const value = useMemo<Localization>(
    () => ({
      locale,
      direction: locale === "ar" ? "rtl" : "ltr",
      setLocale,
      t: (key, params) => translate(locale, key, params),
      count: (key, amount, params) => formatCount(locale, key, amount, params),
      number: (amount, options) => formatNumber(locale, amount, options),
      date: (value, options) => formatDate(locale, value, options),
    }),
    [locale, setLocale],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useLocalization(): Localization {
  const value = useContext(Context);
  if (!value) throw new Error("LocalizationProvider is required.");
  return value;
}
