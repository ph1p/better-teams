import type { SelectHTMLAttributes } from "react";
import { ChevronDown } from "lucide-react";

// Native <select> keeps the OS picker and keyboard handling; only the look is ours.
export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <span className={"tc-select" + (className ? " " + className : "")}>
      <select {...rest}>{children}</select>
      <ChevronDown size={13} aria-hidden />
    </span>
  );
}
