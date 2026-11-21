import type { ComponentType, JSX } from "react";
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
} from "lucide-react";
import { profile } from "../../teamsData";
import { avatarUri, hue, initials } from "../lib/format";
import { STATUS_COLOR, statusLabel, usePresence } from "../lib/presence";
import type { CSSProperties } from "react";
import type { Chat } from "../../types";
import { t } from "../../i18n";

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

// Right-hand profile drawer (Slack-style). Shows the person's details and every
// chat the current user shares with them. Details come from the loaded profile
// row; fields Teams didn't cache simply don't render.
export function ProfilePanel({ mri, chats, sel, onPick, onClose, onMessage, onCall }: ProfilePanelProps): JSX.Element {
  const { statusOf } = usePresence();
  const status = statusOf(mri);
  const ring = status !== "Unknown";
  const p = profile(mri);
  const name = p.displayName || t().common.unknown;
  const rows: Array<[IconComp, string]> = (
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
          <div className="tc-profile-av" style={{ background: `hsl(${hue(name)} 45% 52%)` }}>
            {avatarUri(mri) ? <img src={avatarUri(mri)} alt="" /> : initials(name)}
          </div>
        </div>
        <div className="tc-profile-name">{name}</div>
        {p.email ? <div className="tc-profile-mail">{p.email}</div> : null}
      </div>
      {rows.length ? (
        <div className="tc-profile-details">
          {rows.map(([Icon, v], i) => (
            <div key={i} className="tc-profile-detail">
              <Icon size={15} /> <span>{v}</span>
            </div>
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
          // Group the remaining shared chats: multi-person group chats, then
          // channels. The 1:1 DM is excluded (it's the button above).
          const groups = chats.filter((c) => c.group);
          const channels = chats.filter((c) => c.isChannel);
          const sections: Array<[string, IconComp, Chat[]]> = (
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
