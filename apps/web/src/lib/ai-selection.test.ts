import { describe, expect, test } from "bun:test";
import { payloadFromJson } from "./ai-selection";

/**
 * What the editor sends for a range that covers no words.
 *
 * The editor gives nothing back for such a range, and the editor of the
 * browser crashes when that is read as though it were a doc. A person on an
 * empty line must still be able to ask for something to be written.
 */
describe("the selection that is sent", () => {
  test("a range with no words in it gives nothing, and does not throw", () => {
    expect(payloadFromJson(null)).toEqual({ markdown: "", clips: [] });
    expect(payloadFromJson(undefined)).toEqual({ markdown: "", clips: [] });
  });

  test("a part of a doc with no words in it gives nothing", () => {
    expect(payloadFromJson({ type: "doc" })).toEqual({ markdown: "", clips: [] });
  });

  test("the words of the selection are sent as they are", () => {
    const payload = payloadFromJson({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "The tides of the northern sea." }] }],
    });
    expect(payload.markdown).toContain("The tides of the northern sea.");
    expect(payload.clips).toEqual([]);
  });

  test("a piece of a web page is sent beside it, with its id", () => {
    const payload = payloadFromJson({
      type: "doc",
      content: [{
        type: "clip",
        attrs: { clipId: "clip-one", sourceTitle: "A page" },
        content: [{ type: "paragraph", content: [{ type: "text", text: "The piece itself." }] }],
      }],
    });
    expect(payload.clips).toEqual([{ clipId: "clip-one", text: "The piece itself." }]);
  });
});
