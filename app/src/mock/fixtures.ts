// Seed data for the mock (browser dev server) build: a fictional org with
// direct chats, groups, meetings, two teams with channels and a Notes chat.
// Times are relative to page load, so the sidebar always looks recent.
import type { ChatKind, Profile } from "../types";

export const ME_OID = "00000000-0000-4000-8000-000000000001";
export const ME = "8:orgid:" + ME_OID;

interface Person extends Profile { mri: string }

let seq = 1;
function person(name: string, jobTitle: string, department: string, officeLocation = "Hamburg"): Person {
  const oid = `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`;
  const email = name.toLowerCase().replace(/\s+/g, ".") + "@example.com";
  return { mri: "8:orgid:" + oid, displayName: name, imageUri: "", email, jobTitle, department, officeLocation };
}

const me: Person = {
  mri: ME, displayName: "Sam Taylor", imageUri: "", email: "sam.taylor@example.com",
  jobTitle: "Software Engineer", department: "Engineering", officeLocation: "Hamburg",
};
const maya = person("Maya Chen", "Engineering Lead", "Engineering");
const jonas = person("Jonas Weber", "Backend Developer", "Engineering", "Berlin");
const priya = person("Priya Nair", "Product Manager", "Product", "Remote");
const lukas = person("Lukas Brandt", "Product Designer", "Design");
const sofia = person("Sofia Marquez", "QA Engineer", "Engineering", "Madrid");
const tom = person("Tom Okafor", "DevOps Engineer", "Platform");
const elena = person("Elena Petrova", "Data Scientist", "Analytics", "Remote");
const aiko = person("Aiko Tanaka", "UX Researcher", "Design");
const noah = person("Noah Fischer", "Working Student", "Engineering");
const ben = person("Ben Hughes", "Account Executive", "Sales", "London");
// In the directory only: findable via people search, no chat yet.
const clara = person("Clara Jensen", "Engineering Manager", "Engineering", "Copenhagen");
const david = person("David Kim", "Security Engineer", "Platform", "Remote");

export const PEOPLE: Person[] = [me, maya, jonas, priya, lukas, sofia, tom, elena, aiko, noah, ben, clara, david];

/** Starting presence per person; the store drifts a few of them over time. */
export const PRESENCE: Record<string, string> = {
  [me.mri]: "Available", [maya.mri]: "Busy", [jonas.mri]: "Available", [priya.mri]: "DoNotDisturb",
  [lukas.mri]: "Away", [sofia.mri]: "Available", [tom.mri]: "BeRightBack", [elena.mri]: "Offline",
  [aiko.mri]: "Available", [noah.mri]: "AvailableIdle", [ben.mri]: "Offline", [clara.mri]: "Busy",
  [david.mri]: "Available",
};

export interface SeedMessage {
  from: string;
  /** Minutes before page load. */
  ago: number;
  html: string;
  /** Channel thread: index of the root message within this chat's seed list. */
  replyTo?: number;
  reactions?: Record<string, string[]>;
  edited?: boolean;
  importance?: "high" | "urgent";
  subject?: string;
  files?: string[];
  call?: "start" | "end";
}

export interface SeedChat {
  id: string;
  kind: ChatKind;
  topic?: string;
  team?: string;
  members: string[];
  favorite?: boolean;
  pinned?: boolean;
  hidden?: boolean;
  /** Messages newer than this many minutes ago count as unread. */
  readAgo?: number;
  /** Index of the call root that is running right now. */
  liveCall?: number;
  messages: SeedMessage[];
}

const H = 60;
const D = 24 * H;
const p = (s: string): string => `<p>${s}</p>`;
const mention = (who: Person, i = 0): string =>
  `<span itemtype="http://schema.skype.com/Mention" itemscope itemid="${i}">${who.displayName}</span>`;
const quote = (who: Person, text: string): string =>
  `<blockquote itemscope="" itemtype="http://schema.skype.com/Reply" itemid="0">` +
  `<strong itemprop="mri" itemid="${who.mri}">${who.displayName}</strong>` +
  `<p itemprop="preview">${text}</p></blockquote>`;

// A long scroll-back for the release group, so paging older history works.
const releaseBacklog: SeedMessage[] = Array.from({ length: 60 }, (_, i) => {
  const who = [maya, jonas, sofia, tom, me][i % 5];
  const lines = [
    "Merged the retry fix, CI is green.",
    "Can someone review the migration PR?",
    "Smoke tests pass on staging.",
    "Bumping the API client to 3.2.",
    "Looks good to me.",
    "I'll take the flaky upload test.",
    "Release notes draft is in the wiki.",
    "Rolled back the canary, investigating.",
  ];
  return { from: who.mri, ago: 6 * D - i * 90, html: p(lines[i % lines.length]) };
});

export const CHATS: SeedChat[] = [
  {
    id: "19:dm-maya@unq.gbl.spaces", kind: "chat", members: [maya.mri], readAgo: 30, favorite: true,
    messages: [
      { from: maya.mri, ago: 3 * H, html: p("Morning! Did the nightly build go through?") },
      { from: ME, ago: 3 * H - 2, html: p("Yes, all green. The flaky test was a timezone thing.") },
      { from: maya.mri, ago: 3 * H - 3, html: p("Nice catch 🎉"), reactions: { like: [ME] } },
      { from: maya.mri, ago: 25, html: p("Can you take a look at this before standup?") },
      {
        from: maya.mri, ago: 24,
        html: `<pre class="language-ts"><code>export function retry&lt;T&gt;(fn: () =&gt; Promise&lt;T&gt;, n = 3): Promise&lt;T&gt; {\n  return fn().catch((e) =&gt; (n &gt; 1 ? retry(fn, n - 1) : Promise.reject(e)));\n}</code></pre>`,
      },
      { from: maya.mri, ago: 23, html: p("Should we add a backoff here?") },
    ],
  },
  {
    id: "19:dm-jonas@unq.gbl.spaces", kind: "chat", members: [jonas.mri], readAgo: 0,
    messages: [
      { from: jonas.mri, ago: 2 * D, html: p("Here's the schema dump you asked for."), files: ["schema-2026-11.sql"] },
      { from: ME, ago: 2 * D - 10, html: p("Thanks! Will check tonight.") },
      { from: jonas.mri, ago: 5 * H, html: p(`Hey ${mention(me)}, the cache invalidation PR needs a second reviewer.`) },
      { from: ME, ago: 5 * H - 4, html: quote(jonas, "the cache invalidation PR needs a second reviewer.") + p("On it after lunch."), edited: true },
      { from: jonas.mri, ago: 5 * H - 5, html: p("👍"), reactions: { heart: [ME] } },
    ],
  },
  {
    id: "19:dm-priya@unq.gbl.spaces", kind: "chat", members: [priya.mri], readAgo: 0, favorite: true,
    messages: [
      { from: priya.mri, ago: 1 * D, html: p("Roadmap review moved to Thursday."), importance: "high" },
      { from: ME, ago: 1 * D - 30, html: p("Noted, thanks.") },
    ],
  },
  {
    id: "19:dm-lukas@unq.gbl.spaces", kind: "chat", members: [lukas.mri], readAgo: 0,
    messages: [
      { from: lukas.mri, ago: 4 * D, html: p("New icon set is in Figma, have a look when you can.") },
      { from: ME, ago: 4 * D - 60, html: p("Love the sidebar ones!"), reactions: { laugh: [lukas.mri] } },
    ],
  },
  {
    id: "19:dm-sofia@unq.gbl.spaces", kind: "chat", members: [sofia.mri], readAgo: 90,
    messages: [
      { from: sofia.mri, ago: 3 * D, html: p("Regression suite is at 412 tests now.") },
      { from: sofia.mri, ago: 70, html: p("Found a bug in the export dialog, ticket incoming.") },
    ],
  },
  {
    id: "19:dm-ben@unq.gbl.spaces", kind: "chat", members: [ben.mri], readAgo: 0, hidden: true,
    messages: [{ from: ben.mri, ago: 20 * D, html: p("Thanks for the demo last week!") }],
  },
  {
    id: "19:group-release@thread.v2", kind: "chat", topic: "Release 2.4", pinned: true,
    members: [maya.mri, jonas.mri, sofia.mri, tom.mri], readAgo: 10,
    messages: [
      ...releaseBacklog,
      { from: tom.mri, ago: 50, html: p("Staging deploy is done.") },
      { from: sofia.mri, ago: 12, html: p(`${mention(tom)} the login flow fails on Safari 18 for me.`) },
      { from: jonas.mri, ago: 8, html: p("Probably the SameSite cookie change. Checking."), reactions: { like: [maya.mri, sofia.mri] } },
    ],
  },
  {
    id: "19:group-data@thread.v2", kind: "chat", members: [elena.mri, aiko.mri, noah.mri], readAgo: 0,
    messages: [
      { from: elena.mri, ago: 2 * D, html: p("Survey results are in. Short version:") },
      { from: elena.mri, ago: 2 * D - 1, html: "<ul><li>68% use the keyboard shortcuts</li><li>Search is the top complaint</li><li>Dark mode: overwhelmingly yes</li></ul>" },
      { from: aiko.mri, ago: 2 * D - 20, html: p("Matches the interviews. I'll write it up.") },
      { from: noah.mri, ago: 2 * D - 25, html: p("Can I help with the charts?") },
    ],
  },
  {
    id: "19:meeting-planning@thread.v2", kind: "meeting", topic: "Weekly planning",
    members: [maya.mri, priya.mri, jonas.mri, lukas.mri], readAgo: 0,
    messages: [
      { from: priya.mri, ago: 3 * D, html: p("Agenda: roadmap, hiring, offsite.") },
      { from: maya.mri, ago: 3 * D - 40, html: p("Notes are in Loop, link in the invite.") },
    ],
  },
  {
    id: "19:meeting-design@thread.v2", kind: "meeting", topic: "Design review: onboarding",
    members: [lukas.mri, aiko.mri, priya.mri], readAgo: 0,
    messages: [
      { from: lukas.mri, ago: 6 * D, html: p("Prototype link is pinned in the channel.") },
    ],
  },
  {
    id: "19:platform-general@thread.tacv2", kind: "channel", topic: "General", team: "Platform",
    members: [maya.mri, jonas.mri, tom.mri, david.mri], readAgo: 0, favorite: true,
    messages: [
      { from: tom.mri, ago: 2 * D, html: p("Kubernetes upgrade to 1.33 is scheduled for Friday."), subject: "Cluster upgrade" },
      { from: maya.mri, ago: 2 * D - 30, html: p("Thanks Tom. Any downtime expected?"), replyTo: 0 },
      { from: tom.mri, ago: 2 * D - 35, html: p("Rolling, so none in theory."), replyTo: 0 },
      { from: david.mri, ago: 5 * H, html: p("Reminder: rotate your API keys before the end of the month."), importance: "high" },
      { from: jonas.mri, ago: 4 * H, html: p("Done ✅"), replyTo: 3, reactions: { like: [david.mri] } },
    ],
  },
  {
    id: "19:platform-deploys@thread.tacv2", kind: "channel", topic: "deployments", team: "Platform",
    members: [maya.mri, jonas.mri, tom.mri], readAgo: 60, liveCall: 1,
    messages: [
      { from: tom.mri, ago: 3 * H, html: p("Deploy window opens at 15:00.") },
      { from: tom.mri, ago: 15, html: p("Meeting: <b>Release go/no-go</b>"), call: "start" },
      { from: maya.mri, ago: 14, html: p("Joining in a sec"), replyTo: 1 },
      { from: jonas.mri, ago: 10, html: p("Backend is ready."), replyTo: 1 },
    ],
  },
  {
    id: "19:design-general@thread.tacv2", kind: "channel", topic: "General", team: "Design Guild",
    members: [lukas.mri, aiko.mri], readAgo: 0,
    messages: [
      { from: aiko.mri, ago: 8 * D, html: p("Research repository is live."), subject: "Research repo" },
      { from: lukas.mri, ago: 1 * D, html: p("Design crit") , call: "start" },
      { from: lukas.mri, ago: 1 * D - 45, html: p("Meeting ended · 45 min"), replyTo: 1, call: "end" },
    ],
  },
  {
    id: "48:notes", kind: "notes", members: [], readAgo: 0,
    messages: [
      { from: ME, ago: 7 * D, html: p("Ideas: keyboard nav for threads, compact mode.") },
      { from: ME, ago: 1 * D, html: p("Remember to update the README.") },
    ],
  },
];

/** Canned answers the mock people send back after you write to them. */
export const REPLIES = [
  "Sounds good!",
  "Let me check and get back to you.",
  "👍",
  "Good point. Can we discuss it at standup?",
  "Agreed, ship it.",
  "Hmm, I'm not sure. Do you have numbers for that?",
  "On it.",
  "Thanks, that helps a lot.",
];

/** Background chatter that drops into a random chat now and then. */
export const CHATTER = [
  "Anyone up for lunch?",
  "Build is green again.",
  "Quick question when you have a minute.",
  "Pushed a fix, please pull.",
  "Coffee? ☕",
];
