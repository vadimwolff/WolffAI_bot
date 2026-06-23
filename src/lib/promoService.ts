
import fs from "fs";
import path from "path";

const PROMO_FILE = path.join(process.cwd(), "promocodes.json");

let promoCache: Record<string, any> = {};

const loadPromos = () => {
  if (fs.existsSync(PROMO_FILE)) {
    try {
      promoCache = JSON.parse(fs.readFileSync(PROMO_FILE, "utf-8"));
    } catch (e) {
      console.error("Error reading promoCodes:", e);
    }
  }
  // Seed defaults if not present
  let changed = false;
  if (!promoCache["MAXVERSTAPPENBEST"]) {
    promoCache["MAXVERSTAPPENBEST"] = {
      code: "MAXVERSTAPPENBEST",
      type: "multi_time",
      durationMonths: -1,
      createdAt: new Date().toISOString(),
      usedBy: []
    };
    changed = true;
  }
  if (!promoCache["KOSTASDEBIL"]) {
    promoCache["KOSTASDEBIL"] = {
      code: "KOSTASDEBIL",
      type: "multi_time",
      durationMonths: -1,
      createdAt: new Date().toISOString(),
      usedBy: []
    };
    changed = true;
  }
  if (changed) {
    savePromos();
  }
};

const savePromos = () => {
    fs.writeFileSync(PROMO_FILE, JSON.stringify(promoCache, null, 2), "utf-8");
};

// Simple lock to prevent concurrent modifications
let lock: Promise<any> = Promise.resolve();

export const runWithLock = async <T>(fn: () => Promise<T>): Promise<T> => {
    const result = lock.then(fn);
    lock = result.catch(() => {}); // Maintain the chain
    return result;
};

export const getPromos = () => {
    loadPromos();
    return Object.values(promoCache);
};

export const deletePromo = async (code: string) => {
    return runWithLock(async () => {
        loadPromos();
        const upperCode = code.toUpperCase();
        if (promoCache[upperCode]) {
            delete promoCache[upperCode];
            savePromos();

            // Revoke PRO membership from all users who activated this promo code
            try {
              const usersFile = path.join(process.cwd(), "users.json");
              if (fs.existsSync(usersFile)) {
                const uData = JSON.parse(fs.readFileSync(usersFile, "utf-8"));
                let changedObj = false;
                for (const uId in uData) {
                  if (uData[uId] && uData[uId].promoUsed && uData[uId].promoUsed.toUpperCase() === upperCode) {
                    uData[uId].isSubscribed = false;
                    uData[uId].promoUsed = null;
                    changedObj = true;
                    console.log(`[Promo Revoke] Revoked PRO status for standard user ${uId} (used promo: ${upperCode})`);
                  }
                }
                if (changedObj) {
                  fs.writeFileSync(usersFile, JSON.stringify(uData, null, 2), "utf-8");
                }
              }
            } catch (uErr) {
              console.error("[Promo Revoke] Error revoking promo from users.json:", uErr);
            }

            try {
              const platUsersFile = path.join(process.cwd(), "platform_users.json");
              if (fs.existsSync(platUsersFile)) {
                const puData = JSON.parse(fs.readFileSync(platUsersFile, "utf-8"));
                let changedPlat = false;
                for (const puId in puData) {
                  if (puData[puId] && puData[puId].promoUsed && puData[puId].promoUsed.toUpperCase() === upperCode) {
                    puData[puId].isSubscribed = false;
                    puData[puId].promoUsed = null;
                    if ("premiumUntil" in puData[puId]) {
                      delete puData[puId].premiumUntil;
                    }
                    changedPlat = true;
                    console.log(`[Promo Revoke] Revoked PRO status for platform user ${puId} (used promo: ${upperCode})`);
                  }
                }
                if (changedPlat) {
                  fs.writeFileSync(platUsersFile, JSON.stringify(puData, null, 2), "utf-8");
                }
              }
            } catch (puErr) {
              console.error("[Promo Revoke] Error revoking promo from platform_users.json:", puErr);
            }

            return { success: true };
        }
        return { success: false, error: "Promocode not found" };
    });
};

export const activatePromo = async (code: string, userId: number) => {
    return runWithLock(async () => {
        loadPromos();
        const upperCode = code.toUpperCase();
        const promo = promoCache[upperCode];
        
        if (!promo) return { success: false, error: "Промокод не найден" };
        
        if (promo.type === "one_time" && promo.usedBy && promo.usedBy.length > 0) {
            return { success: false, error: "Этот промокод уже был использован." };
        }
        if (promo.usedBy && promo.usedBy.includes(userId)) {
            return { success: false, error: "Вы уже активировали этот промокод." };
        }
        
        promo.usedBy = promo.usedBy || [];
        promo.usedBy.push(userId);
        savePromos();
        
        return { success: true, promo };
    });
};

export const generatePromo = async (type: "one_time" | "multi_time", durationMonths: number) => {
    return runWithLock(async () => {
        loadPromos();
        const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
        let part1 = "", part2 = "", part3 = "";
        for (let i = 0; i < 4; i++) {
            part1 += chars.charAt(Math.floor(Math.random() * chars.length));
            part2 += chars.charAt(Math.floor(Math.random() * chars.length));
            part3 += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        const code = `WAI-${part1}-${part2}-${part3}`;
        const newPromo = {
            code,
            type,
            durationMonths: Number(durationMonths),
            createdAt: new Date().toISOString(),
            usedBy: []
        };
        promoCache[code] = newPromo;
        savePromos();
        return newPromo;
    });
};
