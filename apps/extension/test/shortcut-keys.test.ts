import { describe, expect, test } from "bun:test";
import { chromeOwnsShortcut, formatShortcut, recommendShortcut, sameShortcut } from "../lib/shortcut-keys";

describe("chromeOwnsShortcut", () => {
  test("knows the keys Chrome keeps", () => {
    expect(chromeOwnsShortcut("Ctrl+Shift+D")).toBe(true);
    expect(chromeOwnsShortcut("Ctrl+Shift+N")).toBe(true);
    expect(chromeOwnsShortcut("Ctrl+1")).toBe(true);
  });

  test("the way the key is written does not matter", () => {
    expect(chromeOwnsShortcut("Ctrl+Shift+D")).toBe(chromeOwnsShortcut("ctrl+shift+d"));
    expect(chromeOwnsShortcut("Command+D")).toBe(chromeOwnsShortcut("Ctrl+D"));
  });

  test("leaves the keys that are free alone", () => {
    expect(chromeOwnsShortcut("Alt+Shift+D")).toBe(false);
    expect(chromeOwnsShortcut("Alt+Shift+S")).toBe(false);
  });
});

describe("formatShortcut", () => {
  test("writes a key the way a person reads it", () => {
    expect(formatShortcut("alt+shift+d")).toBe("Alt+Shift+D");
    expect(formatShortcut("Ctrl+Shift+Space")).toBe("Ctrl+Shift+Space");
  });
});

describe("sameShortcut", () => {
  test("ignores case and the way a modifier is written", () => {
    expect(sameShortcut("alt+shift+d", "Alt+Shift+D")).toBe(true);
    expect(sameShortcut("Command+D", "Ctrl+D")).toBe(true);
  });

  test("an empty key is not the same as anything", () => {
    expect(sameShortcut("", "Alt+Shift+D")).toBe(false);
  });
});

describe("recommendShortcut", () => {
  test("offers the key the command would like", () => {
    expect(recommendShortcut("Alt+Shift+D")).toBe("Alt+Shift+D");
  });

  test("offers another key when the wanted one is taken", () => {
    expect(recommendShortcut("Alt+Shift+D", ["Alt+Shift+D"])).not.toBe("Alt+Shift+D");
  });

  test("never offers a key Chrome keeps", () => {
    const key = recommendShortcut("Ctrl+Shift+D");
    expect(chromeOwnsShortcut(key)).toBe(false);
  });

  test("never offers a key another command is on", () => {
    const taken = ["Alt+Shift+D", "Alt+Shift+N", "Alt+Shift+S", "Alt+Shift+E"];
    const key = recommendShortcut("Alt+Shift+D", taken);
    expect(taken).not.toContain(key);
    expect(chromeOwnsShortcut(key)).toBe(false);
  });

  test("the same key is never offered twice", () => {
    const first = recommendShortcut("Alt+Shift+D", []);
    const second = recommendShortcut("Alt+Shift+D", [first]);
    expect(second).not.toBe(first);
  });
});
