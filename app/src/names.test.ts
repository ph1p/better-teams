import { beforeEach, describe, expect, it } from "vitest";
import { formatName, personName, setNameFormat, shortName } from "./names";

const P = { displayName: "Philip Stapelfeldt" };

describe("formatName", () => {
  it("formats Last-First-free names", () => {
    expect(formatName(P, "first")).toBe("Philip");
    expect(formatName(P, "first-last")).toBe("Philip Stapelfeldt");
    expect(formatName(P, "last-first")).toBe("Stapelfeldt Philip");
    expect(formatName(P, "first-initial")).toBe("Philip S.");
    expect(formatName(P, "teams")).toBe("Philip Stapelfeldt");
  });
  it("parses comma names and strips suffixes", () => {
    expect(formatName({ displayName: "Stapelfeldt, Philip" }, "first-last")).toBe("Philip Stapelfeldt");
    expect(formatName({ displayName: "Stapelfeldt, Philip (Extern)" }, "first-initial")).toBe("Philip S.");
  });
  it("prefers givenName and surname", () => {
    expect(formatName({ displayName: "X", givenName: "Philip", surname: "Stapelfeldt" }, "last-first")).toBe(
      "Stapelfeldt Philip",
    );
  });
  it("leaves unsplittable names unchanged", () => {
    expect(formatName({ displayName: "Anna Maria von Berg" }, "first")).toBe("Anna Maria von Berg");
    expect(formatName({ displayName: "Jira" }, "first-initial")).toBe("Jira");
    expect(formatName({ displayName: "" }, "first")).toBe("");
  });
  it("handles non-ASCII initials", () => {
    expect(formatName({ displayName: "Émile Örtel" }, "first-initial")).toBe("Émile Ö.");
  });
});

describe("shortName and personName", () => {
  beforeEach(() => setNameFormat("teams"));
  it("keeps the first word under teams", () => {
    expect(shortName({ displayName: "Stapelfeldt, Philip" })).toBe("Stapelfeldt");
  });
  it("formats under another format", () => {
    setNameFormat("first");
    expect(shortName({ displayName: "Stapelfeldt, Philip" })).toBe("Philip");
    expect(personName(undefined, "Philip Stapelfeldt", "8:orgid:x")).toBe("Philip");
  });
  it("never reformats apps", () => {
    setNameFormat("first-initial");
    expect(
      personName(
        { displayName: "Jira Cloud", imageUri: "", email: "", jobTitle: "", department: "", officeLocation: "" },
        "Jira Cloud",
        "28:abc",
      ),
    ).toBe("Jira Cloud");
  });
});
