/**
 * Protocol 7.1's receiver: accept a real webhook delivery, verify its
 * signature, scrub it, write it to `evidence/pending/`.
 *
 * `pending/`, not `curated/`: a human reads every scrubbed capture before it
 * moves to the tracked directory — the scrubber makes leaks unlikely, the
 * review makes the promotion deliberate. Nothing here writes anywhere a
 * commit can reach.
 *
 * Zero dependencies. Run: `WEBHOOK_SECRET=… pnpm --filter … capture`.
 */

import { createServer } from "node:http";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { SIGNATURE_HEADER, verifyBody } from "@hiero-hackers/automation-core";
import { scrubPayload } from "./scrub.js";

const secret = process.env["WEBHOOK_SECRET"];
if (secret === undefined || secret === "") {
    console.error("WEBHOOK_SECRET is required (the sandbox App's webhook secret).");
    process.exit(1);
}
const port = Number(process.env["PORT"] ?? 8788);
const pendingDir = fileURLToPath(new URL("../evidence/pending/", import.meta.url));
mkdirSync(pendingDir, { recursive: true });

createServer((request, response) => {
    if (request.method !== "POST") {
        response.writeHead(405).end();
        return;
    }
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
        const body = Buffer.concat(chunks);
        const signature = request.headers[SIGNATURE_HEADER];
        if (!verifyBody(secret!, body, typeof signature === "string" ? signature : undefined)) {
            response.writeHead(401).end();
            return;
        }
        const event = String(request.headers["x-github-event"] ?? "unknown");
        const delivery = String(request.headers["x-github-delivery"] ?? "no-delivery-id");

        let scrubbed: unknown;
        try {
            scrubbed = scrubPayload(JSON.parse(body.toString("utf8")));
        } catch {
            response.writeHead(400).end();
            return;
        }
        const file = join(pendingDir, `${event}-${delivery}.json`);
        writeFileSync(file, JSON.stringify(scrubbed, null, 2) + "\n");
        console.log(`captured ${event} -> ${file}`);
        response.writeHead(202).end();
    });
}).listen(port, () => {
    console.log(`capture listening on :${port}; scrubbed payloads land in evidence/pending/`);
});
