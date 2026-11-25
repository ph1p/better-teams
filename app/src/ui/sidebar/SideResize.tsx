import { PaneResize, dockedWidth } from "../shared/PaneResize";
import { t } from "../../i18n";

// Drag handle on the sidebar's right edge. The width lives in a pref and in the
// --tc-side-w var on #tc-root, which the grid columns read. A docked right pane
// (notes, thread) counts against the room left for the chat.
export function SideResize() {
  return (
    <PaneResize
      pref="sidebarWidth"
      cssVar="--tc-side-w"
      def={300}
      min={220}
      max={520}
      edge="right"
      label={t().sidebar.resize}
      taken={dockedWidth}
    />
  );
}
