import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { defineConfig } from "wxt";
import tailwindcss from "@tailwindcss/vite";

const extensionRoot = fileURLToPath(new URL(".", import.meta.url));
const require = createRequire(import.meta.url);
const reactModule = pathToFileURL(require.resolve("@wxt-dev/module-react")).href;
const wxtDist = resolve(extensionRoot, "node_modules/wxt/dist");
const reactRoot = resolve(extensionRoot, "node_modules/react");
const reactDomRoot = resolve(extensionRoot, "node_modules/react-dom");
const apiOrigin = new URL(process.env.VITE_API_URL ?? "http://localhost:3000").origin;

export default defineConfig({
  srcDir: extensionRoot,
  publicDir: resolve(extensionRoot, "public"),
  entrypointsDir: resolve(extensionRoot, "entrypoints"),
  modulesDir: resolve(extensionRoot, "modules"),
  outDir: resolve(extensionRoot, ".output"),
  modules: [reactModule],
  dev: {
    server: {
      host: "127.0.0.1",
      port: Number(process.env.WXT_PORT ?? 3002),
      strictPort: true,
    },
  },
  vite: () => ({
    plugins: [tailwindcss()],
    resolve: {
      alias: {
        wxt: wxtDist,
        react: reactRoot,
        "react-dom": reactDomRoot,
      },
    },
  }),
  manifest: {
    name: "DataVault",
    description: "Capture and save web text, snippets, and data directly to your DataVault.",
    version: "0.1.0",
    permissions: ["contextMenus", "storage", "identity", "sidePanel", "activeTab", "scripting", "alarms"],
    host_permissions: [`${apiOrigin}/*`],
    action: { default_title: "DataVault" },
    side_panel: { default_path: "sidepanel.html" },
    /**
     * The keyboard shortcuts.
     *
     * Ctrl+Shift+P is left alone because Edge opens InPrivate with it, and
     * Ctrl+Shift+N is left alone because Chrome uses it for Incognito.
     * Ctrl+Shift+D and Ctrl+Shift+A are left alone too, because Chrome keeps
     * them for bookmarking all tabs and for the tab search. Chrome refuses to
     * hand one of those to an extension by itself, and it can take it back, so
     * a shortcut on one of those keys may never arrive.
     *
     * Chrome allows at most four suggested keys, and there are four
     * commands, so each one is given a key of its own. Every one of these
     * keys was watched being handed to an extension by Chrome, so all four
     * can be filled in.
     *
     * Chrome only fills them in the first time the extension is installed,
     * so a key that is cleared by hand stays cleared until it is chosen
     * again on the shortcuts page. The panel in the extension says which key
     * each command has, and offers a free one when it has none.
     */
    commands: {
      "_execute_action": {
        suggested_key: { default: "Alt+Shift+O", mac: "Alt+Shift+O" },
      },
      "add-to-doc": {
        suggested_key: { default: "Alt+Shift+D", mac: "Alt+Shift+D" },
        description: "Add the selected text to the current doc.",
      },
      "new-doc": {
        suggested_key: { default: "Alt+Shift+F", mac: "Alt+Shift+F" },
        description: "Start a new doc. Following clips go into it.",
      },
      "save-as-item": {
        suggested_key: { default: "Alt+Shift+S", mac: "Alt+Shift+S" },
        description: "Save the selected text as a separate saved item.",
      },
    },
  },
});
