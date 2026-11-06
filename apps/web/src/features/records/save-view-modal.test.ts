import { describe, expect, test } from "bun:test";
import { getSuggestedViewName } from "./save-view-modal";

describe("getSuggestedViewName", () => {
  test("returns default when no filters are applied", () => {
    expect(getSuggestedViewName({})).toBe("My view");
    expect(getSuggestedViewName({ folderName: "All folders" })).toBe("My view");
  });

  test("suggests folder name when active folder is set", () => {
    expect(getSuggestedViewName({ folderName: "chopus" })).toBe("chopus");
  });

  test("suggests combination of folder and record type", () => {
    expect(getSuggestedViewName({ folderName: "chopus", recordType: "highlight" })).toBe("chopus · Highlight");
  });

  test("suggests tag and search query", () => {
    expect(getSuggestedViewName({ tag: "science", search: "quantum" })).toBe("#science · \"quantum\"");
  });

  test("suggests trash or archived states", () => {
    expect(getSuggestedViewName({ trash: true })).toBe("Trash");
    expect(getSuggestedViewName({ folderName: "Work", archived: true })).toBe("Work · Archived");
  });
});
