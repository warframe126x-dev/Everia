import { afterEach, expect, test, vi } from "vitest";
import { recoveryExplanation } from "./bootstrap";
import { translate } from "./format";

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});
test("pre-React recovery text follows saved locale and falls back to English", () => {
  for (const locale of ["en", "fr", "ar"]) {
    localStorage.setItem("everia.locale.v1", JSON.stringify(locale));
    expect(recoveryExplanation()).toBe(
      translate(locale as "en" | "fr" | "ar", "backup.recoveryFailed"),
    );
  }
  localStorage.setItem("everia.locale.v1", "corrupt");
  expect(recoveryExplanation()).toBe(translate("en", "backup.recoveryFailed"));
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("unreadable");
  });
  expect(recoveryExplanation()).toBe(translate("en", "backup.recoveryFailed"));
});
