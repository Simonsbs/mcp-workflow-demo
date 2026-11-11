import { DatabaseSync } from "node:sqlite";
import { readFile, readdir } from "node:fs/promises";
export async function sqliteStore(path = ":memory:") {
  const database = new DatabaseSync(path);
  database.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
  database.exec(
    "CREATE TABLE IF NOT EXISTS __migrations (name TEXT PRIMARY KEY)",
  );
  for (const file of (await readdir(new URL("../drizzle/", import.meta.url)))
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    if (
      database.prepare("SELECT name FROM __migrations WHERE name=?").get(file)
    )
      continue;
    database.exec("BEGIN IMMEDIATE");
    try {
      database.exec(
        await readFile(new URL("../drizzle/" + file, import.meta.url), "utf8"),
      );
      database.prepare("INSERT INTO __migrations(name) VALUES(?)").run(file);
      database.exec("COMMIT");
    } catch (e) {
      database.exec("ROLLBACK");
      throw e;
    }
  }
  return {
    database,
    close: () => database.close(),
    async batch(statements) {
      database.exec("BEGIN IMMEDIATE");
      try {
        const results = statements.map(({ sql, args }) => {
          const statement = database.prepare(sql);
          if (/^\s*SELECT\b/i.test(sql)) {
            return { rows: statement.all(...args), changes: 0 };
          }
          const result = statement.run(...args);
          return { rows: [], changes: Number(result.changes) };
        });
        database.exec("COMMIT");
        return results;
      } catch (e) {
        database.exec("ROLLBACK");
        throw e;
      }
    },
  };
}
