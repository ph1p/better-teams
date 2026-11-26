import { useNet } from "../../services/net";
import { t } from "../../i18n";

/** Thin strip above the chat while the connection is down or flaky. */
export function NetBanner() {
  const net = useNet();
  if (net === "online") return null;
  return (
    <div className={"tc-net-banner " + net} role="status" aria-live="polite">
      {net === "offline" ? t().app.netOffline : t().app.netUnstable}
    </div>
  );
}
