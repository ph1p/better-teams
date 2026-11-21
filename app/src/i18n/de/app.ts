import type { Messages } from "../en";

export const app: Messages["app"] = {
  // App shell
  noTeamsData: "Hier gibt es keine Teams-Daten.",
  selectChat: "Wähle einen Chat aus",
  markReadFailed: (reason) => `Als gelesen markieren fehlgeschlagen (${reason})`,
  pill: [
    "Lass mich hier raus",
    "Mach, dass es aufhört",
    "Wo war nochmal der Chat?",
    "Notausgang",
    "Genug gesehen",
    "Zurück zur Vernunft",
  ],
  pillTitle: "Zurück zur ruhigen Ansicht (⌥⌘T)",

  // Chat actions (toasts)
  sentFailedAfterOpen: (reason) => `Chat geöffnet, aber die Nachricht wurde nicht gesendet (${reason})`,
  noEmail: (name) => `Keine E-Mail-Adresse für ${name} hinterlegt.`,
  thisPerson: "diese Person",
  chatOpenedSoon: "Chat in Teams geöffnet. Er erscheint hier in Kürze.",
  chatCreatedSoon: "Chat in Teams erstellt. Er erscheint hier in Kürze.",
  openInTeamsFailed: (reason) => `Chat konnte in Teams nicht geöffnet werden (${reason})`,
  notSent: (reason) => `Nicht gesendet (${reason})`,
  noDmToCall: "Noch kein 1:1-Chat mit dieser Person – starte einen, um sie anzurufen.",
  callFailed: (reason) => `Anruf konnte nicht gestartet werden (${reason})`,
  joinFailed: (reason) => `Teilnahme am Anruf fehlgeschlagen (${reason})`,
  meetingFailed: (reason) => `Besprechung konnte nicht gestartet werden (${reason})`,
  readStateFailed: (reason) => `Lesestatus konnte nicht geändert werden (${reason})`,
  hideFailed: (hidden, reason) =>
    hidden ? `Chat konnte nicht ausgeblendet werden (${reason})` : `Chat konnte nicht eingeblendet werden (${reason})`,
  chatHidden: "Chat ausgeblendet. Die Suche findet ihn; eine neue Nachricht holt ihn zurück.",
  renameFailed: (reason) => `Umbenennen fehlgeschlagen (${reason})`,
  muteFailed: (muted, reason) =>
    muted
      ? `Chat konnte nicht stummgeschaltet werden (${reason})`
      : `Stummschaltung konnte nicht aufgehoben werden (${reason})`,
  addFailed: (reason) => `Personen konnten nicht hinzugefügt werden (${reason})`,
  removeFailed: (reason) => `Person konnte nicht entfernt werden (${reason})`,
  leaveFailed: (reason) => `Chat konnte nicht verlassen werden (${reason})`,
  leaveChannelFailed: (reason) => `Verlassen fehlgeschlagen (${reason})`,
  muted: "Stummgeschaltet. Du erhältst keine Benachrichtigungen für diesen Chat.",
  unmuted: "Stummschaltung aufgehoben.",
  left: (name) => `Du hast ${name} verlassen.`,
  channelHidden: (name) => `${name} ausgeblendet.`,
  channelDeleted: (name) => `${name} gelöscht.`,
  channelCreated: (name) => `${name} erstellt.`,
  channelCreatedSoon: (name) => `${name} erstellt. Er erscheint gleich.`,
  cantAddChannel: "In diesem Team kannst du keine Kanäle hinzufügen",
  createChannelFailed: (reason) => `Kanal konnte nicht erstellt werden (${reason})`,
  deleteChannelFailed: (reason) => `Kanal konnte nicht gelöscht werden (${reason})`,
  membersAdded: (n) => (n === 1 ? "1 Person hinzugefügt." : `${n} Personen hinzugefügt.`),
  memberRemoved: (name) => `${name} entfernt.`,

  // Messages (toasts)
  reactionFailed: (reason) => `Reaktion fehlgeschlagen (${reason})`,
  deleteFailed: (reason) => `Löschen fehlgeschlagen (${reason})`,
  undoFailed: (reason) => `Rückgängig machen fehlgeschlagen (${reason})`,
  removeFileFailed: (reason) => `Entfernen der Datei fehlgeschlagen (${reason})`,
  editFailed: (reason) => `Bearbeiten fehlgeschlagen (${reason})`,

  // Notes panel
  closeNotes: "Notizen schließen",
  closeNotesTitle: "Schließen (⌥N)",
  notesPlaceholder: "Notier dir irgendwas. Wird nur auf diesem Mac gespeichert.",

  // Profile panel
  openDm: "Direkten Chat öffnen",
  startDm: "Direkten Chat in Teams starten",
  messageDirectly: "Direktnachricht",
  audioCallTitle: "Audioanruf in Teams",
  videoCallTitle: "Videoanruf in Teams",
  groupChats: "Gruppenchats",
  channels: "Kanäle",
  noShared: "Keine gemeinsamen Gruppenchats oder Kanäle.",
  viewProfile: (name) => `${name} anzeigen`,
  profile: "Profil",

  // File viewer
  image: "Bild",
  imageLoadFailed: "Das Bild konnte nicht geladen werden.",
  fitToWindow: "An Fenster anpassen",
  actualSize: "Originalgröße",
  cantPreview: "Für diese Datei gibt es hier keine Vorschau.",
  textLoadFailed: "Der Text der Datei konnte nicht geladen werden.",
  textTruncated: "… (gekürzt, für den Rest herunterladen)",
  emptyFile: "(leere Datei)",
  noPreviewType: "Keine Vorschau für diesen Dateityp.",
  noLink: "Teams hat keinen Link zu dieser Datei geteilt. Öffne sie in Teams.",
  download: "Herunterladen",
  saveImage: "Bild speichern",
  copyLink: "Link kopieren",
  closeEsc: "Schließen (Esc)",
  previous: "Zurück (←)",
  next: "Weiter (→)",
  nOfM: (n, m) => `${n} von ${m}`,
};
