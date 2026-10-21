import { describe, expect, test } from "bun:test";
import { pickFolder, type FolderOption } from "../lib/folder-choice";

const folders: FolderOption[] = [
  { id: "personal", name: "Personal Vault", isDefault: true, itemCount: 11 },
  { id: "kg", name: "kg", isDefault: false, itemCount: 0 },
];

describe("pickFolder", () => {
  test("uses the folder that was chosen", () => {
    expect(pickFolder(folders, { defaultVaultId: "kg", defaultVaultOrganizationId: "workspace" }, "workspace")).toBe("kg");
  });

  test("uses the default folder when nothing was chosen", () => {
    expect(pickFolder(folders, {}, "workspace")).toBe("personal");
  });

  test("does not use a folder from another workspace", () => {
    expect(pickFolder(folders, { defaultVaultId: "kg", defaultVaultOrganizationId: "somewhere-else" }, "workspace")).toBe("personal");
  });

  test("does not use a folder that has been removed", () => {
    expect(pickFolder(folders, { defaultVaultId: "gone", defaultVaultOrganizationId: "workspace" }, "workspace")).toBe("personal");
  });

  test("has no folder to offer when the workspace has none", () => {
    expect(pickFolder([], { defaultVaultId: "kg", defaultVaultOrganizationId: "workspace" }, "workspace")).toBe("");
  });
});
