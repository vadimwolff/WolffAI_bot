const fs = require('fs');

let pb = fs.readFileSync('platformBot.ts', 'utf8');
let s = fs.readFileSync('server.ts', 'utf8');

const pbSync = `
  const u = platformUsers[userId];
  
  // Sync PRO status from main users.json
  try {
    const mainUsersStr = fs.readFileSync('users.json', 'utf8');
    const mainUsers = JSON.parse(mainUsersStr);
    if (mainUsers[userId] && (mainUsers[userId].isSubscribed || mainUsers[userId].role === 'admin')) {
      if (!u.isSubscribed) {
        u.isSubscribed = true;
        savePlatformDB();
      }
    }
  } catch(e) {}
`;
pb = pb.replace(/const u = platformUsers\[userId\];/g, pbSync);

const sSync = `
  const u = users[userId];
  
  // Sync PRO from platform_users.json
  try {
    const pUsersStr = fs.readFileSync('platform_users.json', 'utf8');
    const pUsers = JSON.parse(pUsersStr);
    if (pUsers[userId] && pUsers[userId].isSubscribed) {
      if (!u.isSubscribed) {
        u.isSubscribed = true;
        saveDB();
      }
    }
  } catch(e) {}
`;
s = s.replace(/const u = users\[userId\];/g, sSync);

fs.writeFileSync('platformBot.ts', pb);
fs.writeFileSync('server.ts', s);
