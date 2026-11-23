import { describe, expect, it } from "vitest";
import { formatMessage } from "./markdown";

const link = (href: string, label: string) =>
  `<a href="${href}" rel="noreferrer noopener" title="${href}" target="_blank">${label}</a>`;

describe("formatMessage", () => {
  it.each([
    ["hello <world> & co", "<p>hello &lt;world&gt; &amp; co</p>"],
    ["**hi** and _there_", "<p><strong>hi</strong> and <i>there</i></p>"],
    ["see https://example.com/a.", `<p>see ${link("https://example.com/a", "https://example.com/a")}.</p>`],
    ["[x](https://e.com)", `<p>${link("https://e.com", "x")}</p>`],
    ["[x](javascript:alert(1))", "<p>[x](javascript:alert(1))</p>"],
    ["", "<p></p>"],
    ["a\nb\n\nc", "<p>a<br />b</p><p>c</p>"],
  ])("renders %j", (input, html) => {
    const out = formatMessage(input);
    expect(out.html).toBe(html);
    expect(out.mentions).toBe("[]");
  });

  it("renders a code block with a fixed id", () => {
    const out = formatMessage("```ts\nconst a = 1;\n```", [], () => "ID");
    expect(out.html).toBe(
      '<p itemtype="http://schema.skype.com/CodeBlockEditor" id="codeBlockEditor-ID">&nbsp;</p><pre class="language-ts" itemid="codeBlockEditor-ID"><code>const a = 1;</code></pre>',
    );
  });

  it("keeps a mention inside inline code literal", () => {
    const out = formatMessage("hi @Ann Lee and `@Ann Lee`", [
      { mri: "8:orgid:1", name: "Ann Lee", mentionType: "person" },
    ]);
    expect(out.html).toBe(
      '<p>hi <span itemtype="http://schema.skype.com/Mention" itemscope itemid="0">Ann Lee</span> and <code>@Ann Lee</code></p>',
    );
    expect(JSON.parse(out.mentions)).toEqual([
      {
        "@type": "http://schema.skype.com/Mention",
        itemid: 0,
        mri: "8:orgid:1",
        mentionType: "person",
        displayName: "Ann Lee",
      },
    ]);
  });
});
