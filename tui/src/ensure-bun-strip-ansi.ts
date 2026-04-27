/**
 * OpenTUI sanitizes pasted text with `Bun.stripANSI` (see @opentui/core paste handling).
 * That API exists only on newer Bun releases; without it, pasting throws and setup breaks.
 */
import stripAnsi from "strip-ansi";

const bun = Bun as typeof Bun & { stripANSI?: (s: string) => string };
if (typeof bun.stripANSI !== "function") {
  bun.stripANSI = stripAnsi;
}
