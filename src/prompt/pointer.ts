/**
 * The one-line pointer that is sent to a terminal in place of the full prompt.
 *
 * It must be a single line (D-q16): ConPTY on Windows does not bracket a paste, so a newline in the
 * text would arrive as Enter.
 */
export function promptPointerLine(filePath: string): string | undefined {
  if (/[\r\n]/.test(filePath)) return undefined;
  return `Read the review instructions in \`${filePath}\` and follow them.`;
}
