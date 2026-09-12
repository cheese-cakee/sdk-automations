// no-circular, with cycle-b.ts.
import { b } from "./cycle-b.js";

export const a = (): string => b();
