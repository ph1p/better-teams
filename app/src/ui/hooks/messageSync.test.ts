import { describe, expect, it } from "vitest";
import { editedContent, msgSig, prunePending, reuseUnchanged, type Pending } from "./messageSync";
import { buildQuoteHtml } from "../../quote";
import type { Message as Msg } from "../../types";

const msg = (over: Partial<Msg> = {}): Msg => ({
  id: "1",
  rootId: "1",
  rootTime: 0,
  isReply: false,
  from: "Me",
  fromMri: "8:me",
  content: "<p>hi</p>",
  messageType: "RichText/Html",
  mine: true,
  deleted: false,
  edited: false,
  subject: "",
  importance: "normal",
  reactions: [],
  files: [],
  time: 1_000_000,
  ...over,
});

const T = 1_000_000;
const pend = (over: Partial<Pending> = {}): Pending => ({ key: 1, chatId: "c", text: "ok", time: T, ...over });

describe("msgSig", () => {
  it("is equal for identical lists", () => {
    expect(msgSig([msg(), msg({ id: "2" })])).toBe(msgSig([msg(), msg({ id: "2" })]));
  });
  it("differs when only content changes (double edit)", () => {
    const a = msgSig([msg({ edited: true, content: "<p>x</p>" })]);
    const b = msgSig([msg({ edited: true, content: "<p>y</p>" })]);
    expect(a).not.toBe(b);
  });
  it("differs when a file is removed", () => {
    const a = msgSig([msg({ files: [{ name: "a.pdf", url: "", ext: "pdf" }] })]);
    expect(a).not.toBe(msgSig([msg({ files: [] })]));
  });
});

describe("prunePending", () => {
  it("keeps pending when only an old message has the same text", () => {
    const list = [msg({ content: "<p>ok</p>", time: T - 60_000 })];
    const p = [pend()];
    expect(prunePending(p, "c", list, T + 1_000)).toEqual(p);
  });
  it("removes pending once a newer synced copy exists", () => {
    const list = [msg({ content: "<p>ok</p>", time: T + 500 })];
    expect(prunePending([pend()], "c", list, T + 1_000)).toEqual([]);
  });
  it("matches a reply behind its quote blockquote", () => {
    const quote = buildQuoteHtml({ id: "9", from: "Bob", fromMri: "8:bob", text: "q", time: 0 });
    const list = [msg({ content: quote + "<p>hello</p>", time: T + 500 })];
    expect(prunePending([pend({ text: "hello" })], "c", list, T + 1_000)).toEqual([]);
  });
  it("keeps pending of another chat", () => {
    const list = [msg({ content: "<p>ok</p>", time: T + 500 })];
    const p = [pend({ chatId: "other" })];
    expect(prunePending(p, "c", list, T + 1_000)).toEqual(p);
  });
  it("returns the same array when nothing is pruned", () => {
    const p = [pend()];
    expect(prunePending(p, "c", [], T + 1_000)).toBe(p);
  });
  it("prunes a file-only pending by a newer message with the file", () => {
    const list = [msg({ content: "", time: T + 500, files: [{ name: "a.pdf", url: "", ext: "pdf" }] })];
    expect(prunePending([pend({ text: "", files: ["a.pdf"] })], "c", list, T + 1_000)).toEqual([]);
  });
});

describe("editedContent", () => {
  it("renders markdown", () => {
    expect(editedContent("**b**").content).toBe("<p><strong>b</strong></p>");
  });
  it("escapes and prefixes the quote", () => {
    expect(editedContent("a<b", "<blockquote>q</blockquote>").content).toBe("<blockquote>q</blockquote><p>a&lt;b</p>");
  });
});

describe("reuseUnchanged", () => {
  it("keeps the same object for an unchanged message", () => {
    const prev = [msg()];
    expect(reuseUnchanged(prev, [msg()])[0]).toBe(prev[0]);
  });
  it("returns the new object when content changes", () => {
    const next = [msg({ content: "<p>edited</p>" })];
    expect(reuseUnchanged([msg()], next)[0]).toBe(next[0]);
  });
  it("returns the new object when reactions change", () => {
    const next = [msg({ reactions: [{ key: "like", count: 1, mine: true } as Msg["reactions"][number]] })];
    expect(reuseUnchanged([msg()], next)[0]).toBe(next[0]);
  });
  it("passes new ids through and drops ids only in prev", () => {
    const fresh = msg({ id: "2" });
    const out = reuseUnchanged([msg({ id: "1" })], [fresh]);
    expect(out).toHaveLength(1);
    expect(out[0]).toBe(fresh);
  });
  it("follows the order of next", () => {
    const a = msg({ id: "a" });
    const b = msg({ id: "b" });
    const out = reuseUnchanged([a, b], [msg({ id: "b" }), msg({ id: "a" })]);
    expect(out).toEqual([b, a]);
    expect(out[0]).toBe(b);
  });
});
