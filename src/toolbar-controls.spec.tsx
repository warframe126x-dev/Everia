import { afterEach, expect, test } from "vitest";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import App from "./App";
import { LocalizationProvider } from "./localization/Localization";
import type { Locale } from "./localization/locale";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

for (const locale of ["en", "ar"] as const satisfies readonly Locale[]) {
  test(`${locale} Library toolbar keeps grouped Add content, native sort and equal view segments`, () => {
    const { container } = render(
      <LocalizationProvider initialLocale={locale}>
        <App />
      </LocalizationProvider>,
    );
    fireEvent.click(
      container.querySelector<HTMLButtonElement>(".category-games")!,
    );

    const add = container.querySelector<HTMLButtonElement>(".add-button")!;
    const group = add.querySelector(".add-button-content")!;
    expect(group.querySelector("svg")).toBeTruthy();
    expect(group.querySelector("span")?.textContent).toBeTruthy();
    expect(add.children).toHaveLength(1);

    const sort = container.querySelector<HTMLSelectElement>(
      ".sort-select select",
    )!;
    expect(sort).toBeInstanceOf(HTMLSelectElement);
    expect(sort.options).toHaveLength(4);
    expect(
      container.querySelector(".sort-select svg[aria-hidden='true']"),
    ).toBeTruthy();
    fireEvent.change(sort, { target: { value: "title" } });
    expect(sort.value).toBe("title");

    const segments = within(
      container.querySelector<HTMLElement>(".view-toggle")!,
    ).getAllByRole("button");
    expect(segments).toHaveLength(2);
    expect(segments.every((segment) => segment.querySelector("svg"))).toBe(
      true,
    );
    fireEvent.click(segments[1]);
    expect(segments[1].classList.contains("active")).toBe(true);
    expect(document.documentElement.dir).toBe(locale === "ar" ? "rtl" : "ltr");
  });
}
