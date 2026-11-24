// Teams deep links (teams.microsoft.com/l/...) point at a conversation or a
// message. Opened as a URL they replace the Teams page with the web launcher,
// so links to a chat we already have are opened in place instead.
//
//   /l/message/<threadId>/<messageId>?...&parentMessageId=<rootId>
//   /l/chat/<threadId>/conversations?...
//   /l/channel/<threadId>/<channelName>?...

export interface TeamsLink {
  /** Conversation (chat or channel thread) id, e.g. "19:...@thread.tacv2". */
  cid: string;
  /** Message to jump to; empty for a link to the conversation itself. */
  mid: string;
}

const HOSTS = /^(teams\.microsoft\.com|teams\.cloud\.microsoft|teams\.live\.com)$/i;

export function parseTeamsLink(href: string): TeamsLink | null {
  let u: URL;
  try {
    u = new URL(href);
  } catch {
    return null;
  }
  if (!HOSTS.test(u.hostname)) return null;
  const parts = u.pathname.split("/").filter(Boolean);
  const at = parts.indexOf("l");
  if (at < 0) return null;
  const [kind, rawCid, rawMid] = parts.slice(at + 1);
  if (!rawCid || !/^(message|chat|channel)$/.test(kind)) return null;
  let cid: string;
  try {
    cid = decodeURIComponent(rawCid);
  } catch {
    return null;
  }
  if (!cid.startsWith("19:")) return null;
  const mid = kind === "message" && rawMid && /^\d+$/.test(rawMid) ? rawMid : "";
  return { cid, mid };
}
