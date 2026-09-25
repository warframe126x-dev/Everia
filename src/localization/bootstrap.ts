import { storage } from "../storage";
import { translate } from "./format";

/** Safe before React mounts; always has a literal English hard-stop fallback. */
export function recoveryExplanation(): string {
  const english =
    "Everia could not recover an interrupted restore. Your data was preserved. Please retry.";
  try {
    return translate(storage.loadLocale(), "backup.recoveryFailed");
  } catch {
    return english;
  }
}
