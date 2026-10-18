/**
 * Holds the machine awake for the life of a long job: `caffeinate -i` tied to this process on
 * macOS, nothing elsewhere or where it is absent.
 */

import { spawn } from "node:child_process";

/** Stops holding the machine awake; safe to call twice. */
export function keepAwake(platform: string = process.platform): () => void {
    if (platform !== "darwin") return () => undefined;
    const child = spawn("caffeinate", ["-i", "-w", String(process.pid)], { stdio: "ignore" });
    child.on("error", () => undefined);
    return () => void child.kill();
}
