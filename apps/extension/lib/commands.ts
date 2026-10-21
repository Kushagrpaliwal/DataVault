import { browser } from "wxt/browser";
import { chromeOwnsShortcut, formatShortcut, recommendShortcut, sameShortcut } from "./shortcut-keys";

/**
 * The shortcuts DataVault offers.
 *
 * The identifiers match the manifest, so the browser reports them under the
 * same names.
 *
 * There are three of them, and each one saves something. The action of the
 * toolbar button is not one of them: it opens the panel and saves nothing,
 * and the button in the toolbar already does that.
 */
export interface CommandDescription {
  id: string;
  /** What the shortcut is called in the interface. */
  label: string;
  /** The key the extension would like this command to have. */
  preferred: string;
}

/**
 * What each shortcut does.
 *
 * The name says where the text ends up, because "save" means two different
 * things here: a doc, or the Saved list.
 *
 * The order is the order Chrome shows them in. The keys are ones Chrome is
 * known to hand out, so all three can be filled in.
 */
export const COMMANDS: CommandDescription[] = [
  { id: "add-to-doc", label: "Add to the current doc", preferred: "Alt+Shift+D" },
  { id: "new-doc", label: "Start a new doc", preferred: "Alt+Shift+F" },
  { id: "save-as-item", label: "Save as a separate item", preferred: "Alt+Shift+S" },
];

export interface CommandState extends CommandDescription {
  /** The key the browser reports, empty when the command has no key. */
  shortcut: string;
  /** True when the browser may take the key for itself. */
  conflicts: boolean;
  /** A key that is likely free. */
  suggested: string;
  /** True when the key is the one the extension suggested, not one the user chose. */
  suggestedKey: boolean;
}

/**
 * The key the extension suggests for a command.
 */
function suggestedKey(id: string): string | undefined {
  const manifest = browser.runtime.getManifest() as { commands?: Record<string, { suggested_key?: Record<string, string> }> };
  const suggested = manifest.commands?.[id]?.suggested_key;
  if (!suggested) return undefined;
  const isMac = typeof navigator !== "undefined" && navigator.userAgent.includes("Mac");
  return suggested[isMac ? "mac" : "default"] ?? suggested.default;
}

/**
 * What the browser reports for one command.
 *
 * Newer browsers add an `id` next to the `name`, and a manifest command is
 * reported under its manifest key.
 */
interface ReportedCommand {
  id?: string;
  name?: string;
  shortcut?: string;
}

async function reportedCommands(): Promise<ReportedCommand[]> {
  const commands = await browser.commands?.getAll().catch(() => []);
  return (commands ?? []) as ReportedCommand[];
}

/**
 * Every command of the extension, with the key it has now.
 *
 * A command with no key is still listed, because that is the state a person
 * needs to see before they choose one. The key that is offered with it is
 * one that Chrome does not keep, and that none of the other commands is on.
 */
export async function readCommandStates(): Promise<CommandState[]> {
  const reported = await reportedCommands();
  const keyOf = (id: string) => {
    const command = reported.find((item) => (item.id ?? item.name) === id);
    return command?.shortcut?.trim() ?? "";
  };

  return COMMANDS.map((description) => {
    const shortcut = keyOf(description.id);
    const taken = COMMANDS.map((item) => keyOf(item.id)).filter((key) => key && !sameShortcut(key, shortcut));
    return {
      ...description,
      shortcut: shortcut ? formatShortcut(shortcut) : "",
      conflicts: shortcut ? chromeOwnsShortcut(shortcut) : false,
      suggested: recommendShortcut(description.preferred, taken),
      suggestedKey: sameShortcut(shortcut, suggestedKey(description.id)),
    };
  });
}

/**
 * Change the key of a command.
 *
 * Chrome only lets the person choose the keys themselves, so this is only
 * possible in the browsers that allow it. Where it is not possible, the
 * person is taken to the page where they can.
 */
export async function applyShortcut(command: string, shortcut: string): Promise<boolean> {
  const commands = browser.commands as unknown as { update?: (name: string, key: string) => Promise<void> };
  if (typeof commands?.update !== "function") return false;
  try {
    await commands.update(command, shortcut);
    return true;
  } catch {
    return false;
  }
}
