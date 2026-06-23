const fs = require('fs');
let pb = fs.readFileSync('platformBot.ts', 'utf8');
pb = pb.replace(/u\.activeModel = "gemini-3\.1-pro-preview";/g, 'u.activeModel = "gemini-2.5-pro";');
fs.writeFileSync('platformBot.ts', pb);
