/** Search UI recovery uses this code; diagnostic text is never parsed for actions. */
export class ProviderSearchError extends Error {
  constructor(
    readonly code: string,
    readonly diagnostic?: string,
  ) {
    super(diagnostic ?? code);
    this.name = "ProviderSearchError";
  }
}
