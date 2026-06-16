import { vi } from "vitest";

/** Run `fn` capturing console.log output; returns the joined stdout text. */
export async function captureStdout(fn: () => Promise<void> | void): Promise<string> {
  const lines: string[] = [];
  const spy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  });
  try {
    await fn();
  } finally {
    spy.mockRestore();
  }
  return lines.join("\n");
}

/** Run a JSON-mode command and parse the single JSON payload it printed. */
export async function captureJson<T = unknown>(fn: () => Promise<void> | void): Promise<T> {
  const out = await captureStdout(fn);
  // The last well-formed JSON object/array in the output.
  const start = out.indexOf("{");
  return JSON.parse(out.slice(start)) as T;
}
