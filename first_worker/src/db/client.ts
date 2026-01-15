/**
 * Neon Postgres connection wrapper using serverless driver.
 */

import { neon, NeonQueryFunction } from "@neondatabase/serverless";
import { env } from "../env";
import { createLogger } from "../log/logger";

const log = createLogger("db-client");

let sqlClient: NeonQueryFunction<false, false> | null = null;

/**
 * Get or create the SQL client singleton.
 * Uses lazy initialization to avoid errors when env vars are not set.
 */
export function getSqlClient(): NeonQueryFunction<false, false> {
	if (!sqlClient) {
		log.info("Initializing Neon database connection");
		sqlClient = neon(env.NEON_DATABASE_URL);
	}
	return sqlClient;
}

/**
 * Reset the SQL client (useful for testing or reconnection).
 */
export function resetSqlClient(): void {
	sqlClient = null;
}

export type SqlClient = NeonQueryFunction<false, false>;
