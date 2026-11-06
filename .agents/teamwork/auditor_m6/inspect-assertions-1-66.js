const fs = require('fs');

const content = fs.readFileSync('scripts/verify-auto-social.ts', 'utf8');
const lines = content.split('\n');

const assertions = [];
let i = 0;
while (i < lines.length) {
  let line = lines[i];
  if ((line.includes('assert(') || line.includes('assertThrowsAsync(')) && 
      !line.includes('function assert') && 
      !line.includes('assertZeroOutbound')) {
    let full = line.trim();
    let startLine = i + 1;
    while (!full.includes(');') && !full.endsWith(')') && i + 1 < lines.length) {
      i++;
      full += ' ' + lines[i].trim();
    }
    assertions.push({ startLine, text: full });
  }
  i++;
}

console.log('Total assertions: ' + assertions.length);
assertions.slice(0, 66).forEach((a, idx) => {
  console.log((idx + 1) + '. Line ' + a.startLine + ': ' + a.text);
});
