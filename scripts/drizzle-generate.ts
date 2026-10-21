/**
 * Generate a Drizzle migration without a terminal.
 *
 * Drizzle Kit asks a question for every table that disappeared from the
 * schema, and the question needs a real terminal, so the usual
 * `bun run db:generate` fails in a script, in a shell without a TTY, and in
 * continuous integration.
 *
 * The answer is always the same: the table was removed, not renamed. This
 * wrapper makes the process look like it has a terminal and answers each
 * question with the default choice, which is the one that removes the table.
 */
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
Object.defineProperty(process.stderr, "isTTY", { value: true, configurable: true });

/** Every question is answered with the first choice, which is the right one. */
let answered = false;
const answer = () => {
  if (answered) return;
  answered = true;
  setTimeout(() => {
    process.stdin.emit("keypress", "\r", { name: "return", ctrl: false, shift: false, meta: false });
  }, 20);
};

if (!process.stdin.setRawMode) {
  process.stdin.setRawMode = () => process.stdin;
}
process.stdin.resume();

const originalWrite = process.stdout.write.bind(process.stdout);
process.stdout.write = ((chunk: unknown, ...rest: unknown[]) => {
  const text = typeof chunk === "string" ? chunk : String(chunk);
  /**
   * The question is drawn with the name of the table in it. Each answer
   * clears one question, and there is one question per removed table.
   */
  if (/Is .* (created or renamed|renamed to)/.test(text)) answer();
  return (originalWrite as (...args: unknown[]) => boolean)(chunk, ...rest);
}) as typeof process.stdout.write;

const require = createRequire(import.meta.url);
/**
 * The command is inside the package rather than named by it, because the
 * package does not say which files may be imported.
 */
const packageRoot = dirname(require.resolve("drizzle-kit/package.json"));
await import(pathToFileURL(join(packageRoot, "bin.cjs")).href);
