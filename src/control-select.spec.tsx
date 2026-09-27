import { afterEach, expect, test, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ControlSelect } from "./ControlSelect";

afterEach(cleanup);

for (const direction of ["ltr", "rtl"] as const) {
  test(`${direction} controlled presentation retains native keyboard and select semantics`, async () => {
    const onChange = vi.fn();
    const { container, getByRole } = render(
      <div dir={direction}>
        <ControlSelect>
          <select
            aria-label="Category"
            defaultValue="games"
            onChange={onChange}
          >
            <option value="games">Games</option>
            <option value="anime">Anime</option>
          </select>
        </ControlSelect>
      </div>,
    );
    const select = getByRole("combobox", {
      name: "Category",
    }) as HTMLSelectElement;
    const wrapper = select.closest(".control-select")!;
    expect(wrapper.querySelector("svg[aria-hidden='true']")).toBeTruthy();
    expect(wrapper.querySelectorAll("select")).toHaveLength(1);
    expect(wrapper.querySelector("button")).toBeNull();
    expect(container.firstElementChild?.getAttribute("dir")).toBe(direction);
    const user = userEvent.setup();
    await user.tab();
    expect(document.activeElement).toBe(select);
    await user.selectOptions(select, "anime");
    expect(select.value).toBe("anime");
    expect(onChange).toHaveBeenCalledTimes(1);
  });
}
