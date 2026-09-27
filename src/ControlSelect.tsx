import { ChevronDown } from "lucide-react";
import type { ReactElement } from "react";

/** Keep the native select interaction while rendering its indicator separately. */
export function ControlSelect({ children }: { children: ReactElement }) {
  return (
    <span className="control-select">
      {children}
      <ChevronDown size={16} aria-hidden="true" />
    </span>
  );
}
