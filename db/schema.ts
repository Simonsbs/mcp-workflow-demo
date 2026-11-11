import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
export const workspaces = sqliteTable(
  "workspaces",
  {
    id: text("id").primaryKey(),
    createdAt: text("created_at").notNull(),
    expiresAt: text("expires_at").notNull(),
    revision: integer("revision").notNull().default(0),
    state: text("state").notNull(),
  },
  (t) => [
    index("workspace_expiry").on(t.expiresAt),
    index("workspace_created").on(t.createdAt),
  ],
);
export const tokens = sqliteTable(
  "tokens",
  {
    hash: text("hash").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    principal: text("principal").notNull(),
  },
  (t) => [index("tokens_workspace").on(t.workspaceId)],
);
