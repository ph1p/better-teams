import type { JSX, SelectHTMLAttributes } from "react";
import { ChevronDown } from "lucide-react";

// Native <select> (keeps the OS picker and keyboard handling) with the app's
// own field look: theme colors, rounded box, a lucide chevron instead of the
// platform arrow.
export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>): JSX.Element {
  return (
    <span className={"tc-select" + (className ? " " + className : "")}>
      <select {...rest}>{children}</select>
      <ChevronDown size={13} aria-hidden />
    </span>
  );
}
