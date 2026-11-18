// Run as: node pasteProbe.cjs <record file> <ready file>
// Enables bracketed paste, then records every byte chunk that arrives on stdin.
const fs = require('node:fs');

const [recordFile, readyFile] = process.argv.slice(2);

process.stdout.write('\x1b[?2004h');
process.stdin.setRawMode(true);
process.stdin.on('data', (chunk) => {
  fs.appendFileSync(recordFile, chunk);
});
process.stdin.resume();
fs.writeFileSync(readyFile, 'ready');
