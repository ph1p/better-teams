import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { RichHtml } from "./richText";

const render = (html: string) => renderToStaticMarkup(<RichHtml html={html} />);

describe("RichHtml links", () => {
  it("keeps https links", () => {
    expect(render('<p><a href="https://example.com">ok</a></p>')).toContain('href="https://example.com"');
  });

  it("drops javascript: links but keeps the text", () => {
    const out = render('<p><a href="javascript:alert(1)">click</a></p>');
    expect(out).toContain("click");
    expect(out).not.toContain("href=");
    expect(out).not.toContain("javascript:");
  });

  it("drops entity-obfuscated javascript: links", () => {
    expect(render('<p><a href="java&#x09;script:alert(1)">x</a></p>')).not.toContain("href=");
  });
});

describe("RichHtml images", () => {
  it("loads Microsoft-hosted images directly", () => {
    expect(render('<p><img src="https://eu-prod.asyncgw.teams.microsoft.com/a/views/imgo" alt="pic"></p>')).toContain(
      "<img",
    );
  });

  it("gates external https images behind a button", () => {
    const out = render('<p><img src="https://i.imgur.com/x.gif" alt="cat"></p>');
    expect(out).not.toContain("<img");
    expect(out).toContain("tc-img-gate");
    expect(out).toContain("imgur.com");
    expect(out).toContain("cat");
  });

  it("loads Giphy images directly", () => {
    expect(render('<p><img src="https://media.giphy.com/media/x/giphy.gif" alt="cat"></p>')).toContain("<img");
  });

  it("shows a link to an image as the picture, not the URL text", () => {
    const url = "https://media.giphy.com/media/v1.abc/84BjZMVEX3aRG/giphy.gif";
    const out = render(`<p><a href="${url}">${url}</a></p>`);
    expect(out).toContain(`<img class="tc-inline-img" src="${url}" alt=""`);
    expect(out).toContain(`data-link="${url}"`);
    expect(out).not.toContain("<a");
    expect(out).not.toContain(`>${url}<`);
  });

  it("gates a link to an untrusted image without showing the URL text", () => {
    const out = render('<p><a href="https://i.imgur.com/x.gif">https://i.imgur.com/x.gif</a></p>');
    expect(out).toContain("tc-img-gate");
    expect(out).not.toContain("<a");
  });

  it("renders http images as alt text", () => {
    const out = render('<p><img src="http://evil.example/p.png" alt="pic"></p>');
    expect(out).not.toContain("<img");
    expect(out).toContain("pic");
  });

  it("drops javascript: image sources", () => {
    expect(render('<p><img src="javascript:alert(1)"></p>')).not.toContain("<img");
  });
});
