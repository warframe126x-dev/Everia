/** Isolate an inserted name from surrounding translated prose without changing stored data. */
export const isolateBidi = (value: string): string => `\u2068${value}\u2069`;
