import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/**
 * A release build must point at the real server. Without the variables the
 * app would fall back to localhost, which would ship a build that talks to
 * nothing (or to some other program on the user's machine). Set
 * ALLOW_LOCAL_BUILD=true to build against localhost on purpose.
 */
function assertReleaseUrls() {
  if (process.env.ALLOW_LOCAL_BUILD === "true") return;
  for (const name of ["VITE_API_URL", "VITE_WEB_URL"]) {
    const value = process.env[name] ?? "";
    let ok = false;
    try {
      const url = new URL(value);
      ok = url.protocol === "https:" && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    } catch { /* not a URL */ }
    if (!ok) throw new Error(`${name} must be an https address that is not localhost for a release build (got "${value}"). Set ALLOW_LOCAL_BUILD=true to build against localhost on purpose.`);
  }
}

export default defineConfig(({ command }) => {
  if (command === "build") assertReleaseUrls();
  return {
  plugins: [react(), tailwindcss()],
  server: {
    port: Number(process.env.VITE_PORT ?? 5173),
    strictPort: true,
    proxy: {
      "/api": {
        target: process.env.VITE_API_URL ?? "http://localhost:3000",
        changeOrigin: true,
      },
    },
  },
};
});
