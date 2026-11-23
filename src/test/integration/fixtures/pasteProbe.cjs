// Run as: node pasteProbe.cjs <record file> <ready file>
// Enables bracketed paste, then records every byte chunk that arrives on stdin.
// A failure before the ready file is written goes to `<ready file>.err`, so the test can say why.
const fs = require('node:fs');

const [recordFile, readyFile] = process.argv.slice(2);

try {
  process.stdout.write('\x1b[?2004h');
  process.stdin.setRawMode(true);
  process.stdin.on('data', (chunk) => {
    fs.appendFileSync(recordFile, chunk);
  });
  process.stdin.resume();
  fs.writeFileSync(readyFile, 'ready');
} catch (err) {
  const detail = `stdin.isTTY=${process.stdin.isTTY} stdout.isTTY=${process.stdout.isTTY}\n${err && err.stack}`;
  fs.writeFileSync(`${readyFile}.err`, detail);
  throw err;
}
