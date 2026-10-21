import net from "node:net";

type PortMap = { api: number; web: number; extension: number };

const root = process.cwd();

function configuredPort(name: string, fallback: number) {
  const value = Number(process.env[name] ?? fallback);
  return Number.isInteger(value) && value > 0 && value < 65_536 ? value : fallback;
}

function canListen(port: number, host: string) {
  return new Promise<boolean>((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.listen({ host, port }, () => {
      server.close(() => resolve(true));
    });
  });
}

async function isPortAvailable(port: number) {
  return (await canListen(port, "127.0.0.1")) && (await canListen(port, "::1"));
}

async function choosePort(preferred: number, used: Set<number>) {
  for (let port = preferred; port < 65_536; port += 1) {
    if (!used.has(port) && await isPortAvailable(port)) {
      used.add(port);
      return port;
    }
  }
  throw new Error(`No free port found near ${preferred}.`);
}

async function getPorts(): Promise<PortMap> {
  const used = new Set<number>();
  return {
    api: await choosePort(configuredPort("API_PORT", 3000), used),
    web: await choosePort(configuredPort("VITE_PORT", 5173), used),
    extension: await choosePort(configuredPort("WXT_PORT", 3002), used),
  };
}

function withPort(url: string, port: number) {
  const parsed = new URL(url);
  parsed.port = String(port);
  return parsed.toString().replace(/\/$/, "");
}

const ports = await getPorts();
const apiUrl = withPort(process.env.API_URL ?? "http://localhost:3000", ports.api);
const webUrl = withPort(process.env.WEB_URL ?? "http://localhost:5173", ports.web);
const configuredOrigins = (process.env.ALLOWED_ORIGINS ?? "").split(",").map((origin) => origin.trim()).filter(Boolean);
const allowedOrigins = [...new Set([webUrl, ...configuredOrigins])].join(",");
const baseEnv = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
const childEnv = {
  ...baseEnv,
  API_PORT: String(ports.api),
  API_URL: apiUrl,
  WEB_URL: webUrl,
  VITE_PORT: String(ports.web),
  WXT_PORT: String(ports.extension),
  VITE_API_URL: apiUrl,
  VITE_WEB_URL: webUrl,
  WXT_API_URL: apiUrl,
  WXT_WEB_URL: webUrl,
  ALLOWED_ORIGINS: allowedOrigins,
};

console.log(`DataVault dev servers: web ${webUrl}, API ${apiUrl}, extension http://localhost:${ports.extension}`);

/**
 * Warn when a port had to move.
 *
 * The extension has the API and website addresses built into it when it is
 * packaged. If a port moves, the extension that is already loaded in the
 * browser still points at the old one, so signing in fails with no message
 * at all. This warning says what happened.
 */
const configuredApiPort = Number(process.env.API_PORT ?? 3000);
const configuredWebPort = Number(process.env.VITE_PORT ?? 5173);
if (ports.api !== configuredApiPort || ports.web !== configuredWebPort) {
  console.warn("");
  console.warn("  ! A port was already in use, so the dev servers moved.");
  console.warn(`    The API is now on ${apiUrl} and the website on ${webUrl}.`);
  console.warn("    Reload the DataVault extension in your browser so it picks up the new addresses.");
  console.warn("    Close whatever is using the old ports to get the usual addresses back.");
  console.warn("");
}

let shuttingDown = false;
let commands: Bun.Subprocess[] = [];

async function shutdown(signal: string, exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Stopping DataVault dev servers (${signal})...`);
  for (const process of commands) process.kill();
  await Promise.all(commands.map((process) => process.exited));
  process.exit(exitCode);
}

commands = [
  { name: "api", cwd: root, command: ["bun", "--watch", "apps/api/src/index.ts"] },
  { name: "web", cwd: `${root}/apps/web`, command: ["bun", "run", "dev"] },
  { name: "extension", cwd: `${root}/apps/extension`, command: ["bun", "run", "dev"] },
].map(({ name, cwd, command }) => {
  const process = Bun.spawn(command, {
    cwd,
    env: childEnv,
    stdout: "inherit",
    stderr: "inherit",
  });
  process.exited.then((exitCode) => {
    if (exitCode !== 0) {
      console.error(`DataVault ${name} dev server exited with code ${exitCode}.`);
      void shutdown(`${name} exited`, exitCode);
    }
  });
  return process;
});

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
await Promise.all(commands.map((process) => process.exited));
