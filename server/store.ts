export type SqlValue = string | number | null;
export type Sql = { sql: string; args: SqlValue[] };
export type SqlResult = { rows: Record<string, unknown>[]; changes: number };
export interface Store {
  batch(statements: Sql[]): Promise<SqlResult[]>;
}
export const query = (sql: string, ...args: SqlValue[]): Sql => ({ sql, args });
