/**
 * Stop in the order that loses nothing: the socket, then the tick, then the passes
 * already in flight, then the store. The join is NOT a new drain, which would claim
 * exactly the work being abandoned. A claim the process dies holding is invisible for
 * the full stale window, and that is the cost this ordering buys off.
 */

import { detailOf, type Log } from "../log.js";

/** Everything a shutdown touches, in the order it touches them. */
export interface ShutdownParts {
    /** The edge. `close` answers when the LAST connection has left. */
    readonly server: {
        close(done: () => void): void;
        closeIdleConnections(): void;
    };
    readonly stopTick: () => void;
    /** The pass already in flight, if any. Never one this starts. */
    readonly settled: () => Promise<void>;
    readonly store: { close(): void };
    readonly log: Log;
    /** Where the last line went; an exit truncates what is still queued, so leaving waits. */
    readonly out: { write(chunk: string, done: () => void): unknown };
    readonly exit: () => void;
}

export function createShutdown(parts: ShutdownParts): (signal: NodeJS.Signals) => void {
    const { server, stopTick, settled, store, log, out, exit } = parts;
    let stopping = false;
    return (signal) => {
        // A second signal during a shutdown is impatience, not new information.

        if (stopping) return;
        stopping = true;
        void (async () => {
            const closed = new Promise<void>((resolve) => {
                try {
                    server.close(() => resolve());
                } catch {
                    resolve();
                }
                try {
                    server.closeIdleConnections();
                } catch {}
            });
            try {
                stopTick();
            } catch {}
            try {
                await closed;
            } catch {}
            try {
                await settled();
            } catch {}
            try {
                store.close();
            } catch (error) {
                try {
                    log({ event: "storeCloseFailed", detail: detailOf(error) });
                } catch {}
            }
            try {
                log({ event: "shutdown", signal });
            } catch {}
            let left = false;
            const leave = () => {
                if (left) return;
                left = true;
                exit();
            };
            try {
                out.write("", leave);
            } catch {
                leave();
            }
        })();
    };
}
