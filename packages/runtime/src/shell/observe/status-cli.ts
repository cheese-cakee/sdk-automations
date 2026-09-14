/** `pnpm shell:status`: the lines printed, exit 1 when no store answered. */

import { readStatus } from "./status.js";

const answer = readStatus();
for (const line of answer.lines) process.stdout.write(`${line}\n`);
process.exit(answer.opened ? 0 : 1);
