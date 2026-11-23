import type { Messages } from "../en";

export const composer: Messages["composer"] = {
  jumpToNewest: "Zur neuesten Nachricht",
  replyInThread: (from: string) => `Im Thread antworten · ${from}`,
  postAsNew: "Als neue Unterhaltung posten (Esc)",
  cancelThreadReply: "Thread-Antwort abbrechen",
  cancelQuote: "Zitat abbrechen",
  attachTitle: "Dateien anfügen (oder hier einfügen / ablegen)",
  attach: "Dateien anfügen",
  emoji: "Emoji",
  codeBlockTitle:
    "Codeblock (⌘⇧C)\n**fett** ⌘B · *kursiv* ⌘I · `Code` ⌘E · ~~durchgestrichen~~ ⌘⇧X\n```Sprache für hervorgehobenen Code · - Listen · > Zitate",
  insertCodeBlock: "Codeblock einfügen",
  codeTitle: "Codeblock",
  codeEditTitle: "Codeblock bearbeiten",
  codeLanguage: "Sprache",
  codePlaceholder: "Code einfügen oder tippen…",
  codeHint: "Tab einrücken · Shift+Tab ausrücken",
  codePlain: "Nur Text",
  codeInsert: "Einfügen",
  placeholderThread: "Im Thread antworten…",
  placeholderChannel: (channel: string) => `Neuen Beitrag in #${channel} beginnen`,
  placeholderChat: (title: string) => `Nachricht an ${title}`,
  sendTitle: "Senden (Eingabe) · Umschalt+Eingabe für neue Zeile",
  searchEmoji: "Emoji suchen",
  noEmoji: "Kein Emoji",
  filesWithQuote:
    "Dateien können noch nicht mit einem Zitat oder einer Thread-Antwort gesendet werden. Brich es ab, um zu senden.",
  sendFailed: (reason: string) => `Senden fehlgeschlagen: ${reason}`,
  sendErrors: {
    "chat-not-open":
      "Teams zeigt keine Zeile für diesen Chat. Öffne ihn einmal in Teams (⌥⌘T) und versuch es dann erneut.",
    "wrong-chat": "Teams hat zu einem anderen Chat gewechselt. Nicht gesendet.",
    "no-composer": "Das Nachrichtenfeld von Teams wurde nicht gefunden. Nicht gesendet.",
    "fetch-failed": "Teams-Backend nicht erreichbar. Nicht gesendet.",
    "http-401":
      "Das Teams-Token ist abgelaufen. Öffne einen Chat in Teams, um es zu erneuern, und versuch es dann erneut.",
    "http-403": "Das Teams-Backend hat das Senden abgelehnt (403). Nicht gesendet.",
    "no-token-thread": "Teams ist noch nicht bereit zum Senden. Versuch es gleich noch einmal.",
    "native-busy": "Das Nachrichtenfeld von Teams enthält bereits Dateien. Sende oder entferne sie zuerst in Teams.",
    "no-file-input": "Das Anfügen-Menü von Teams wurde nicht gefunden. Nicht gesendet.",
    "upload-timeout": "Teams hat den Upload nicht rechtzeitig abgeschlossen. Nicht gesendet.",
    "no-send-button": "Die Senden-Schaltfläche von Teams war nicht bereit. Nicht gesendet.",
    "fallback-quote":
      "Teams ist noch nicht bereit für Zitat-Antworten. Versuch es gleich noch einmal oder entferne das Zitat.",
    "fallback-mentions": "Teams ist noch nicht bereit für @Erwähnungen. Versuch es gleich noch einmal. Nicht gesendet.",
    "native-draft":
      "Das Nachrichtenfeld von Teams enthält bereits Text. Sende oder leere es zuerst in Teams. Nicht gesendet.",
    "not-confirmed": "Teams hat das Senden nicht bestätigt. Prüfe den Chat, bevor du es erneut versuchst.",
  },
};
