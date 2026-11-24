import type { ComponentType } from "react";
import {
  X,
  Mail as MailIcon,
  Briefcase,
  Building2,
  MapPin,
  MessageSquare,
  Users,
  Phone,
  Video,
  Hash,
  Copy,
  Check,
} from "lucide-react";
import { useCopied } from "../lib/clipboard";
import { useDismiss } from "../lib/dismiss";
import { profile } from "../../teamsData";
import { avatarUri, hue, initials } from "../lib/format";
import { STATUS_COLOR, statusLabel, usePresence } from "../lib/presence";
import type { CSSProperties } from "react";
import type { Chat } from "../../types";
import { t } from "../../i18n";
import { fullName } from "../../names";

interface ProfilePanelProps {
  mri: string;
  chats: Chat[];
  sel: string | null;
  onPick: (id: string) => void;
  onClose: () => void;
  onMessage?: () => void;
  onCall?: (kind: "audio" | "video") => void;
}

type IconComp = ComponentType<{ size?: number }>;

function DetailRow({ icon: Icon, value }: { icon: IconComp; value: string }) {
  const [copied, copy] = useCopied();
  return (
    <div className="tc-profile-detail">
      <Icon size={15} /> <span title={value}>{value}</span>
      <button
        className={"tc-profile-copy" + (copied ? " on" : "")}
        onClick={() => copy(value)}
        title={copied ? t().chat.copied : t().app.copy}
        aria-label={t().app.copy}
      >
        {copied ? <Check size={13} /> : <Copy size={13} />}
      </button>
    </div>
  );
}

// Details come from the loaded profile row; fields Teams didn't cache simply don't render.
export function ProfilePanel({ mri, chats, sel, onPick, onClose, onMessage, onCall }: ProfilePanelProps) {
  const { statusOf } = usePresence();
  useDismiss(true, "#tc-root .tc-profile", onClose);
  const status = statusOf(mri);
  const ring = status !== "Unknown";
  const p = profile(mri);
  // Avatar initials and colour keep Teams' own name. The profile always shows
  // the full "First Last" name, whatever the name format setting says.
  const rawName = p.displayName || t().common.unknown;
  const name = fullName(p, mri) || rawName;
  const rows = (
    [
      [MailIcon, p.email],
      [Briefcase, p.jobTitle],
      [Building2, p.department],
      [MapPin, p.officeLocation],
    ] as Array<[IconComp, string]>
  ).filter(([, v]) => v);
  return (
    <aside className="tc-profile">
      <div className="tc-profile-head">
        <button className="tc-profile-close" onClick={onClose} title={t().common.close} aria-label={t().common.close}>
          <X size={16} />
        </button>
      </div>
      <div className="tc-profile-id">
        <div
          className={"tc-profile-av-ring" + (ring ? " on is-" + status.toLowerCase() : "")}
          style={ring ? ({ "--tc-ring": STATUS_COLOR[status] } as CSSProperties) : undefined}
          title={ring ? statusLabel(status) : undefined}
        >
          <div className="tc-profile-av" style={{ background: `hsl(${hue(rawName)} 45% 52%)` }}>
            {avatarUri(mri) ? <img src={avatarUri(mri)} alt="" /> : initials(rawName)}
          </div>
        </div>
        <div className="tc-profile-name">{name}</div>
      </div>
      {rows.length ? (
        <div className="tc-profile-details">
          {rows.map(([Icon, v], i) => (
            <DetailRow key={i} icon={Icon} value={v} />
          ))}
        </div>
      ) : null}
      {/* The 1:1 direct chat with this person, if one already exists. Shown only
          as a top action button — never listed in the grouped chats below. */}
      {(() => {
        const dm = chats.find((c) => c.kind === "chat" && (c.members || []).length === 1);
        return (
          <div className="tc-profile-actions">
            <button
              className="tc-profile-dm"
              onClick={() => (dm ? onPick(dm.id) : onMessage?.())}
              title={dm ? t().app.openDm : t().app.startDm}
            >
              <MessageSquare size={15} />
              <span>{t().app.messageDirectly}</span>
              {dm && dm.unread ? <span className="tc-unread" /> : null}
            </button>
            <button
              className="tc-profile-call"
              onClick={() => onCall?.("audio")}
              title={t().app.audioCallTitle}
              aria-label={t().common.audioCall}
            >
              <Phone size={16} />
            </button>
            <button
              className="tc-profile-call"
              onClick={() => onCall?.("video")}
              title={t().app.videoCallTitle}
              aria-label={t().common.videoCall}
            >
              <Video size={16} />
            </button>
          </div>
        );
      })()}
      {/* One scroll container for every group, so the panel scrolls as a whole. */}
      <div className="tc-profile-scroll">
        {(() => {
          // The 1:1 DM is excluded: it's the button above.
          const groups = chats.filter((c) => c.group);
          const channels = chats.filter((c) => c.isChannel);
          const sections = (
            [
              [t().app.groupChats, Users, groups],
              [t().app.channels, Hash, channels],
            ] as Array<[string, IconComp, Chat[]]>
          ).filter(([, , rows]) => rows.length);
          if (!sections.length) return <div className="tc-profile-empty">{t().app.noShared}</div>;
          return sections.map(([title, SecIcon, rows]) => (
            <div key={title} className="tc-profile-group">
              <div className="tc-profile-sec">
                <SecIcon size={14} /> {title}
                <span className="tc-sec-n">{rows.length}</span>
              </div>
              {rows.map((c) => (
                <button
                  key={c.id}
                  className={"tc-profile-chat" + (c.id === sel ? " sel" : "")}
                  onClick={() => onPick(c.id)}
                >
                  {c.isChannel ? <Hash size={15} /> : <Users size={15} />}
                  <span className="tc-profile-chat-title">{c.title}</span>
                  {c.unread ? <span className="tc-unread" /> : null}
                </button>
              ))}
            </div>
          ));
        })()}
      </div>
    </aside>
  );
}
