/**
 * Characters that make the pointer line unsafe to paste into a shell (D-q17):
 * - line break: arrives as Enter (D-q16);
 * - ' and the typographic single quotes: end the single-quoted string in sh and PowerShell;
 * - & | < > ^ %: special to cmd.exe even inside single quotes.
 */
const UNSAFE_IN_POINTER = /[\r\n'\u2018\u2019\u201A\u201B&|<>^%]/;

/**
 * The one-line pointer that is sent to a terminal in place of the full prompt.
 *
 * It must be a single line (D-q16): ConPTY on Windows does not bracket a paste, so a newline in the
 * text would arrive as Enter. The path is single-quoted so a shell does not expand it; a path that
 * cannot be quoted safely gives no line (D-q17).
 */
export function promptPointerLine(filePath: string): string | undefined {
  if (UNSAFE_IN_POINTER.test(filePath)) return undefined;
  return `Read the review instructions in '${filePath}' and follow them.`;
}
