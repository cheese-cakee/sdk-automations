/** `pnpm shell:explain`: the answer printed, exit 1 when nothing was found. */

import { explain } from "./explain.js";

const answer = explain(process.argv.slice(2));
for (const line of answer.lines) process.stdout.write(`${line}\n`);
process.exit(answer.found ? 0 : 1);
