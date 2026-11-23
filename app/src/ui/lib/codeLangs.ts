// Languages offered by the code block dialog. The id is what goes after the
// ``` fence, and so into the sent `<pre class="language-<id>">`; "" is plain
// text. Only some of them are highlighted here (see highlight.ts); Teams
// highlights the rest on its side.
export const CODE_LANGS: readonly (readonly [id: string, label: string])[] = [
  ["", "Plain text"],
  ["bash", "Bash / Shell"],
  ["c", "C"],
  ["cpp", "C++"],
  ["csharp", "C#"],
  ["css", "CSS"],
  ["diff", "Diff"],
  ["go", "Go"],
  ["graphql", "GraphQL"],
  ["html", "HTML"],
  ["java", "Java"],
  ["javascript", "JavaScript"],
  ["json", "JSON"],
  ["kotlin", "Kotlin"],
  ["markdown", "Markdown"],
  ["php", "PHP"],
  ["powershell", "PowerShell"],
  ["python", "Python"],
  ["ruby", "Ruby"],
  ["rust", "Rust"],
  ["scss", "SCSS"],
  ["sql", "SQL"],
  ["swift", "Swift"],
  ["typescript", "TypeScript"],
  ["xml", "XML"],
  ["yaml", "YAML"],
];

// Short names people type after ``` mapped to the list's ids.
const ALIAS: Record<string, string> = {
  plaintext: "",
  text: "",
  txt: "",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  console: "bash",
  "c++": "cpp",
  cs: "csharp",
  "c#": "csharp",
  golang: "go",
  htm: "html",
  js: "javascript",
  mjs: "javascript",
  jsx: "javascript",
  kt: "kotlin",
  md: "markdown",
  ps1: "powershell",
  py: "python",
  rb: "ruby",
  rs: "rust",
  ts: "typescript",
  tsx: "typescript",
  yml: "yaml",
};

/** A fence's language as a list id; an unknown one comes back lowercased as is. */
export function codeLangId(lang: string): string {
  const l = lang.trim().toLowerCase();
  return ALIAS[l] ?? l;
}

/** A fence language's display name ("ts" → "TypeScript"); unknown ones as given. */
export function codeLangLabel(lang: string): string {
  const id = codeLangId(lang);
  return (id && CODE_LANGS.find(([x]) => x === id)?.[1]) || lang;
}
