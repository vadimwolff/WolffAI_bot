import { db } from "./index.ts";
import { dbUsers, dbChats } from "./schema.ts";
import { eq, and } from "drizzle-orm";

export async function getOrCreateUser(uid: string, email: string) {
  try {
    const result = await db.insert(dbUsers)
      .values({
        uid,
        email,
      })
      .onConflictDoUpdate({
        target: dbUsers.uid,
        set: { email },
      })
      .returning();

    return result[0];
  } catch (error) {
    console.error("Database user upsert failed:", error);
    throw new Error("Unable to create or fetch user.", { cause: error });
  }
}

export async function getUserChats(userUid: string, botType: string) {
  try {
    const result = await db.select()
      .from(dbChats)
      .where(
        and(
          eq(dbChats.userUid, userUid),
          eq(dbChats.botType, botType)
        )
      );
    return result;
  } catch (error) {
    console.error("Database fetch chats failed:", error);
    throw new Error("Unable to retrieve chats from database.", { cause: error });
  }
}

export async function upsertChat(userUid: string, chatId: string, botType: string, name: string, mode: string, model: string, history: any) {
  try {
    const result = await db.insert(dbChats)
      .values({
        id: chatId,
        userUid,
        botType,
        name,
        mode,
        model,
        history,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: dbChats.id,
        set: {
          name,
          mode,
          model,
          history,
          updatedAt: new Date(),
        },
      })
      .returning();

    return result[0];
  } catch (error) {
    console.error("Database chat upsert failed:", error);
    throw new Error("Unable to sync chat to database.", { cause: error });
  }
}

export async function deleteChatInDb(userUid: string, chatId: string) {
  try {
    await db.delete(dbChats)
      .where(
        and(
          eq(dbChats.id, chatId),
          eq(dbChats.userUid, userUid)
        )
      );
    return true;
  } catch (error) {
    console.error("Database delete chat failed:", error);
    throw new Error("Unable to remove chat from database.", { cause: error });
  }
}
