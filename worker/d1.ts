import type { Store, Sql, SqlResult } from "../server/store.ts";
export class D1Store implements Store {
  database: Env["DB"];
  constructor(database: Env["DB"]) {
    this.database = database;
  }
  async batch(statements: Sql[]): Promise<SqlResult[]> {
    const result = await this.database.batch<Record<string, unknown>>(
      statements.map((s) => this.database.prepare(s.sql).bind(...s.args)),
    );
    return result.map((r) => ({ rows: r.results, changes: r.meta.changes }));
  }
}
