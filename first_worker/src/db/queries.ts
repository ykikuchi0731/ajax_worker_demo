/**
 * Database query functions for CRUD operations.
 */

import type { SqlClient } from "./client";
import type { SyncRecord, TableColumn } from "../sync/types";
import { createLogger } from "../log/logger";

const log = createLogger("db-queries");

/**
 * Check if a table exists in the public schema.
 */
export async function tableExists(
	sql: SqlClient,
	tableName: string
): Promise<boolean> {
	const result = await sql`
		SELECT EXISTS (
			SELECT FROM information_schema.tables
			WHERE table_schema = 'public'
			AND table_name = ${tableName}
		) as exists
	`;
	return result[0]?.exists === true;
}

/**
 * Get all columns for a table from information_schema.
 */
export async function getTableColumns(
	sql: SqlClient,
	tableName: string
): Promise<TableColumn[]> {
	const result = await sql`
		SELECT column_name, data_type, is_nullable
		FROM information_schema.columns
		WHERE table_schema = 'public' AND table_name = ${tableName}
		ORDER BY ordinal_position
	`;
	return result as TableColumn[];
}

/**
 * Execute a raw SQL query string (for DDL operations).
 * Uses sql.query() method for dynamic SQL strings.
 */
export async function executeRaw(
	sql: SqlClient,
	query: string
): Promise<unknown[]> {
	return await sql.query(query, []);
}

/**
 * Upsert a sync record into the target table.
 * Uses INSERT ... ON CONFLICT DO UPDATE for atomic upsert.
 */
export async function upsertRecord(
	sql: SqlClient,
	tableName: string,
	record: SyncRecord,
	columns: string[]
): Promise<void> {
	// Build column names list: special columns + property columns
	const allColumns = ["notion_page_id", "page_content", "synced_at", ...columns];

	// Build values array in same order
	const values: unknown[] = [
		record.notion_page_id,
		record.page_content,
		record.synced_at.toISOString(),
		...columns.map((col) => {
			const value = record.properties[col];
			return value;
		}),
	];

	// Build placeholders ($1, $2, ...)
	const placeholders = values.map((_, i) => `$${i + 1}`).join(", ");

	// Build UPDATE SET clause (exclude primary key)
	const updateSet = allColumns
		.filter((col) => col !== "notion_page_id")
		.map((col) => `"${col}" = EXCLUDED."${col}"`)
		.join(", ");

	// Build column names with quotes for safety
	const quotedColumns = allColumns.map((col) => `"${col}"`).join(", ");

	const query = `
		INSERT INTO "${tableName}" (${quotedColumns})
		VALUES (${placeholders})
		ON CONFLICT (notion_page_id) DO UPDATE SET ${updateSet}
	`;

	await sql.query(query, values);
	log.info(`Upserted record: ${record.notion_page_id}`);
}

/**
 * Get all existing page IDs from the table.
 */
export async function getExistingPageIds(
	sql: SqlClient,
	tableName: string
): Promise<string[]> {
	const query = `SELECT notion_page_id FROM "${tableName}"`;
	const result = await sql.query(query, []);
	return result.map(
		(row: Record<string, unknown>) => row.notion_page_id as string
	);
}

/**
 * Delete a record by page ID.
 */
export async function deleteRecord(
	sql: SqlClient,
	tableName: string,
	pageId: string
): Promise<void> {
	const query = `DELETE FROM "${tableName}" WHERE notion_page_id = $1`;
	await sql.query(query, [pageId]);
	log.info(`Deleted record: ${pageId}`);
}
