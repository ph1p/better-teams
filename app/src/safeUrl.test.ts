import { describe, expect, it } from "vitest";
import { isImageUrl, isTrustedImgHost, safeHref, safeImgSrc } from "./safeUrl";

const AMS = "https://eu-prod.asyncgw.teams.microsoft.com/v1/objects/x/views/imgo";

describe("safeHref", () => {
  it.each([
    ["https://example.com/a?b=1", "https://example.com/a?b=1"],
    ["http://example.com", "http://example.com"],
    ["mailto:a@b.c", "mailto:a@b.c"],
    ["javascript:alert(1)", ""],
    ["JavaScript:alert(1)", ""],
    [" javascript:alert(1)", ""],
    ["java\tscript:alert(1)", ""],
    ["data:text/html,<b>x</b>", ""],
    ["vbscript:x", ""],
    ["/relative/path", ""],
    ["", ""],
  ])("%j -> %j", (input, out) => {
    expect(safeHref(input)).toBe(out);
  });
});

describe("safeImgSrc", () => {
  it.each([
    [AMS, AMS],
    ["http://example.com/a.png", ""],
    ["data:image/png;base64,AAAA", ""],
    ["javascript:alert(1)", ""],
  ])("%j -> %j", (input, out) => {
    expect(safeImgSrc(input)).toBe(out);
  });
});

describe("isTrustedImgHost", () => {
  it.each([
    [AMS, true],
    ["https://contoso.sharepoint.com/a.png", true],
    ["https://media.giphy.com/media/x/giphy.gif", true],
    ["https://giphy.com.evil.example/a.gif", false],
    ["https://imgur.com/a.gif", false],
    ["https://microsoft.com.evil.example/a.png", false],
    ["https://evilmicrosoft.com/a.png", false],
    ["not a url", false],
  ])("%j -> %j", (input, out) => {
    expect(isTrustedImgHost(input)).toBe(out);
  });
});

describe("isImageUrl", () => {
  it.each([
    ["https://media.giphy.com/media/v1.abc/84BjZMVEX3aRG/giphy.gif", true],
    ["https://example.com/a.PNG?x=1", true],
    ["https://example.com/page.html", false],
    ["http://example.com/a.gif", false],
    ["not a url", false],
  ])("%j -> %j", (input, out) => {
    expect(isImageUrl(input)).toBe(out);
  });
});
