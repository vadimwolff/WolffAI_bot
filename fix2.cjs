const fs = require('fs');
let s = fs.readFileSync('platformBot.ts', 'utf8');
s = s.replace(/modelId\.replace\(\/gemini-\(3\\\\\.5\|3\\\\\.1\|2\\\\\.5\)\.\*\/, "gemini-1\.5-flash"\)/g, 'modelId');
s = s.replace(/const fallbacks = \["gemini-3\.5-flash"\]/g, 'const fallbacks = ["gemini-1.5-flash"]');
fs.writeFileSync('platformBot.ts', s);

let s2 = fs.readFileSync('server.ts', 'utf8');
s2 = s2.replace(/model = model\.replace\(\/gemini-\(3\\\\\.5\|3\\\\\.1\|2\\\\\.5\)\.\*\/, "gemini-1\.5-flash"\);/g, '');
s2 = s2.replace(/if \(\!candidates\.includes\("gemini-1\.5-flash"\)\).*?\n.*?if \(\!candidates\.includes\("gemini-2\.5-pro"\)\).*?\n/g, 'if (!candidates.includes("gemini-1.5-flash")) candidates.push("gemini-1.5-flash");\n  if (!candidates.includes("gemini-2.5-pro")) candidates.push("gemini-2.5-pro");\n');
fs.writeFileSync('server.ts', s2);
