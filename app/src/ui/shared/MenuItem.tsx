import type { JSX, ReactNode } from "react";

/**
 * One `.tc-menu` entry. `close` (the menu's dismiss) runs before `onPick`, so
 * an action that opens a dialog or flashes a toast does so after the menu is
 * gone. `danger` reddens it; `armed` marks a danger item waiting for its
 * confirming second click (see useArm), whose handler closes the menu itself.
 */
export function MenuItem({
  icon,
  children,
  onPick,
  close,
  danger,
  armed,
}: {
  icon: JSX.Element;
  children: ReactNode;
  onPick: () => void;
  close?: () => void;
  danger?: boolean;
  armed?: boolean;
}) {
  return (
    <button
      className={"tc-menu-item" + (danger ? " danger" : "") + (armed ? " armed" : "")}
      role="menuitem"
      onClick={() => {
        close?.();
        onPick();
      }}
    >
      {icon} {children}
    </button>
  );
}
