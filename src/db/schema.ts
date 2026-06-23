import { pgTable, text, timestamp, jsonb } from "drizzle-orm/pg-core";

// Users table using Firebase Auth UID as primary key
export const dbUsers = pgTable("users", {
  uid: text("uid").primaryKey().notNull(),
  email: text("email").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

// Chats table to persist chat histories for all bots across devices
export const dbChats = pgTable("chats", {
  id: text("id").primaryKey().notNull(), // chat session unique id
  userUid: text("user_uid").references(() => dbUsers.uid).notNull(),
  botType: text("bot_type").notNull(), // "wolff" | "angry" | "platform"
  name: text("name").notNull(),
  mode: text("mode").notNull().default("fast"), // "fast" | "thinking" | "search"
  model: text("model").notNull().default("gemini-2.5-pro"), // Platform active model
  history: jsonb("history").notNull().default([]), // The history array
  updatedAt: timestamp("updated_at").defaultNow(),
});
