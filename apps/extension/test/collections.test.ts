import { describe, expect, test } from "bun:test";
import { pickCollection, type CollectionOption } from "../lib/collections";

const collections: CollectionOption[] = [
  { id: "reading", name: "Reading", itemCount: 4 },
  { id: "long", name: "Long", itemCount: 1 },
];

describe("pickCollection", () => {
  test("uses the collection that was chosen", () => {
    expect(pickCollection(collections, { defaultCollectionId: "reading", defaultCollectionVaultId: "kg" }, "kg")).toBe("reading");
  });

  test("has no collection when nothing was chosen", () => {
    expect(pickCollection(collections, {}, "kg")).toBe("");
  });

  test("does not use a collection of another folder", () => {
    expect(pickCollection(collections, { defaultCollectionId: "reading", defaultCollectionVaultId: "personal" }, "kg")).toBe("");
  });

  test("does not use a collection that has been removed", () => {
    expect(pickCollection(collections, { defaultCollectionId: "gone", defaultCollectionVaultId: "kg" }, "kg")).toBe("");
  });

  test("has no collection when the folder is not known", () => {
    expect(pickCollection(collections, { defaultCollectionId: "reading", defaultCollectionVaultId: "kg" }, undefined)).toBe("");
  });

  test("has no collection when the folder has none", () => {
    expect(pickCollection([], { defaultCollectionId: "reading", defaultCollectionVaultId: "kg" }, "kg")).toBe("");
  });
});
