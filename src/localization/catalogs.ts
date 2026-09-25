/** English defines the keys and message kinds for every locale. */
export const en = {
  "common.cancel": "Cancel",
  "common.savedFor": "Saved for {name}",
  "home.entryCount": { one: "{count} entry", other: "{count} entries" },
  "settings.language": "Language",
  "errors.unavailable": "{source} is currently unavailable.",
  "accessibility.openEntry": "Open {title}",
} as const;

export type MessageKey = keyof typeof en;
export type PluralCategory = Intl.LDMLPluralRule;
export type PluralMessage = { other: string } & Partial<
  Record<PluralCategory, string>
>;
export type CatalogShape = {
  [K in MessageKey]: (typeof en)[K] extends string ? string : PluralMessage;
};

export const fr = {
  "common.cancel": "Annuler",
  "common.savedFor": "Enregistré pour {name}",
  "home.entryCount": { one: "{count} entrée", other: "{count} entrées" },
  "settings.language": "Langue",
  "errors.unavailable": "{source} est actuellement indisponible.",
  "accessibility.openEntry": "Ouvrir {title}",
} satisfies CatalogShape;

export const ar = {
  "common.cancel": "إلغاء",
  "common.savedFor": "تم الحفظ لـ {name}",
  "home.entryCount": {
    zero: "{count} إدخالات",
    one: "{count} إدخال",
    two: "{count} إدخالان",
    few: "{count} إدخالات",
    many: "{count} إدخالًا",
    other: "{count} إدخال",
  },
  "settings.language": "اللغة",
  "errors.unavailable": "{source} غير متاح حاليًا.",
  "accessibility.openEntry": "افتح {title}",
} satisfies CatalogShape;
