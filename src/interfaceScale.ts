export const interfaceScales = [1, 1.1, 1.25] as const;
export type InterfaceScale = (typeof interfaceScales)[number];

export function isInterfaceScale(value: unknown): value is InterfaceScale {
  return interfaceScales.some((scale) => scale === value);
}

export function interfaceScaleOrDefault(value: unknown): InterfaceScale {
  return isInterfaceScale(value) ? value : 1;
}
