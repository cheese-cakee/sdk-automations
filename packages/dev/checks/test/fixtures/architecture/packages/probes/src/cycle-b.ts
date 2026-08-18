// no-circular, with cycle-a.ts.
import { a } from "./cycle-a.js";

export const b = (): string => a();
