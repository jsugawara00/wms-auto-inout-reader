import { Pool, types, type PoolClient } from "pg";

// Postgres クライアント（試作の mysql2 から移植）。
// - DATE / TIMESTAMP は JS Date にせず文字列で受ける（試作の dateStrings 相当。
//   照合・表示とも文字列ベースの挙動を維持する）
// - NUMERIC は number で受ける（在庫数量 12,3 は JS number で安全に表現できる範囲）
// - 日時列は timestamp（JST壁時計）。記録は SQL 側の jst_now() で行う

// DATE (oid 1082) → 'YYYY-MM-DD'
types.setTypeParser(1082, (v) => v);
// TIMESTAMP (oid 1114) → 'YYYY-MM-DD HH:MM:SS'（小数秒は落とす）
types.setTypeParser(1114, (v) => v.replace(/\.\d+$/, ""));
// NUMERIC (oid 1700) → number
types.setTypeParser(1700, (v) => Number(v));
// BIGINT (oid 20) → number（COUNT(*) 等。件数は安全な範囲）
types.setTypeParser(20, (v) => Number(v));

// dev のホットリロードでプールが増殖しないよう globalThis に保持
const globalForDb = globalThis as unknown as { wmsPool?: Pool };

export function getPool(): Pool {
  if (!globalForDb.wmsPool) {
    globalForDb.wmsPool = new Pool({
      connectionString:
        process.env.DATABASE_URL ?? "postgres://wms:wmsdev@127.0.0.1:5433/wms",
      max: 10,
    });
  }
  return globalForDb.wmsPool;
}

export type Params = Record<string, unknown>;

/**
 * 名前付きプレースホルダ（:name）を pg の位置パラメータ（$1..）へ変換する。
 * 試作（mysql2 namedPlaceholders）のSQL表記を維持するための薄い変換層。
 * `::date` 等のキャストは変換対象にならない。
 */
function toPositional(sql: string, params: Params): { text: string; values: unknown[] } {
  const values: unknown[] = [];
  const indexByName = new Map<string, number>();
  const text = sql.replace(/(?<![:\w]):([a-zA-Z_][a-zA-Z0-9_]*)/g, (_m, name: string) => {
    if (!(name in params)) {
      throw new Error(`SQLパラメータ :${name} が渡されていません`);
    }
    let idx = indexByName.get(name);
    if (idx === undefined) {
      values.push(params[name] === undefined ? null : params[name]);
      idx = values.length;
      indexByName.set(name, idx);
    }
    return `$${idx}`;
  });
  return { text, values };
}

/** プール直結・トランザクション内で共通のクエリインターフェース */
export interface Queryable {
  /** SELECT / RETURNING 付きDML：行の配列を返す */
  rows<T = Record<string, unknown>>(sql: string, params?: Params): Promise<T[]>;
  /** INSERT/UPDATE/DELETE：影響行数を返す */
  exec(sql: string, params?: Params): Promise<number>;
}

class Executor implements Queryable {
  constructor(private readonly client: Pool | PoolClient) {}
  async rows<T = Record<string, unknown>>(sql: string, params: Params = {}): Promise<T[]> {
    const { text, values } = toPositional(sql, params);
    const res = await this.client.query(text, values);
    return res.rows as T[];
  }
  async exec(sql: string, params: Params = {}): Promise<number> {
    const { text, values } = toPositional(sql, params);
    const res = await this.client.query(text, values);
    return res.rowCount ?? 0;
  }
}

/** プール直結のクエリ実行（トランザクション不要な読み取り等） */
export function db(): Queryable {
  return new Executor(getPool());
}

/** トランザクション実行ヘルパー。fn が throw したらロールバック。 */
export async function withTransaction<T>(
  fn: (conn: Queryable) => Promise<T>
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(new Executor(client));
    await client.query("COMMIT");
    return result;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
