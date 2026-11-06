import { describe, expect, test } from "bun:test";
import { csvCell, toCsv } from "./csv";

describe("csv export", () => {
  test("formulas are written as text", () => {
    expect(csvCell("=1+1")).toBe(`"'=1+1"`);
    expect(csvCell("@SUM(A1)")).toBe(`"'@SUM(A1)"`);
    expect(csvCell("-2")).toBe(`"'-2"`);
  });
  test("quotes and commas stay inside the cell", () => {
    expect(csvCell('say "hi", ok')).toBe(`"say ""hi"", ok"`);
  });
  test("builds rows", () => {
    expect(toCsv(["A", "B"], [["x", "=y"]])).toBe(`"A","B"\n"x","'=y"`);
  });
});
