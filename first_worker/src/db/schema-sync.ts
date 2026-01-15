/**
 * Schema synchronization: Notion DB schema -> Postgres table structure.
 */

import type { Client } from "@notionhq/client";
import type { SqlClient } from "./client";
import type {
	SchemaMapping,
	NotionPropertyType,
	SchemaSyncResult,
} from "../sync/types";
import { tableExists, getTableColumns, executeRaw } from "./queries";
import { createLogger } from "../log/logger";

const log = createLogger("schema-sync");

// Map Notion property types to Postgres column types
const TYPE_MAP: Record<NotionPropertyType, string> = {
	title: "TEXT",
	rich_text: "TEXT",
	number: "NUMERIC",
	select: "TEXT",
	multi_select: "TEXT[]",
	date: "TIMESTAMPTZ",
	checkbox: "BOOLEAN",
	url: "TEXT",
	email: "TEXT",
	phone_number: "TEXT",
	formula: "TEXT",
	relation: "TEXT[]",
	rollup: "TEXT",
	created_time: "TIMESTAMPTZ",
	created_by: "TEXT",
	last_edited_time: "TIMESTAMPTZ",
	last_edited_by: "TEXT",
	files: "TEXT[]",
	people: "TEXT[]",
	status: "TEXT",
	unique_id: "TEXT",
};

/**
 * Sanitize a Notion property name for use as a Postgres column name.
 * - Lowercase
 * - Replace non-alphanumeric with underscore
 * - Remove leading/trailing underscores
 * - Collapse multiple underscores
 */
export function sanitizeColumnName(name: string): string {
	return name
		.toLowerCase()
		.replace(/[^a-z0-9_]/g, "_")
		.replace(/^_+|_+$/g, "")
		.replace(/_+/g, "_");
}

/**
 * Derive a table name from the Notion database ID.
 */
export function getTableName(databaseId: string): string {
	const sanitized = databaseId.replace(/-/g, "_").substring(0, 20);
	return `notion_${sanitized}`;
}

/**
 * Fetch the schema (properties) from a Notion database.
 */
export async function fetchNotionSchema(
	notion: Client,
	databaseId: string
): Promise<SchemaMapping> {
	log.info(`Fetching schema for database: ${databaseId}`);

	const db = await notion.databases.retrieve({ database_id: databaseId });

	if (!("properties" in db)) {
		throw new Error("Unable to retrieve database properties");
	}

	const mapping: SchemaMapping = {};

	for (const [propName, propDef] of Object.entries(db.properties)) {
		const notionType = propDef.type as NotionPropertyType;
		const postgresType = TYPE_MAP[notionType];

		if (postgresType) {
			mapping[propName] = {
				notionType,
				postgresType,
				columnName: sanitizeColumnName(propName),
			};
		} else {
			log.warn(
				`Unsupported property type: ${notionType} for property: ${propName}`
			);
		}
	}

	log.info(`Found ${Object.keys(mapping).length} supported properties`);
	return mapping;
}

/**
 * Synchronize the schema to Postgres: create table or add missing columns.
 */
export async function syncSchema(
	sql: SqlClient,
	tableName: string,
	schema: SchemaMapping
): Promise<SchemaSyncResult> {
	const result: SchemaSyncResult = { created: false, columnsAdded: [] };

	const exists = await tableExists(sql, tableName);

	if (!exists) {
		// Create new table with all columns
		const columnDefs = [
			"notion_page_id TEXT PRIMARY KEY",
			"page_content TEXT",
			"synced_at TIMESTAMPTZ DEFAULT NOW()",
			...Object.values(schema).map((s) => `"${s.columnName}" ${s.postgresType}`),
		];

		const createQuery = `CREATE TABLE "${tableName}" (${columnDefs.join(", ")})`;
		await executeRaw(sql, createQuery);

		log.info(`Created table: ${tableName}`);
		result.created = true;
	} else {
		// Get existing columns
		const existingCols = await getTableColumns(sql, tableName);
		const existingNames = new Set(existingCols.map((c) => c.column_name));

		// Add missing property columns
		for (const prop of Object.values(schema)) {
			if (!existingNames.has(prop.columnName)) {
				const alterQuery = `ALTER TABLE "${tableName}" ADD COLUMN "${prop.columnName}" ${prop.postgresType}`;
				await executeRaw(sql, alterQuery);
				result.columnsAdded.push(prop.columnName);
				log.info(`Added column: ${prop.columnName}`);
			}
		}

		// Ensure special columns exist
		const specialCols: Array<{ name: string; def: string }> = [
			{ name: "notion_page_id", def: "notion_page_id TEXT PRIMARY KEY" },
			{ name: "page_content", def: "page_content TEXT" },
			{ name: "synced_at", def: "synced_at TIMESTAMPTZ DEFAULT NOW()" },
		];

		for (const col of specialCols) {
			if (!existingNames.has(col.name)) {
				// Can't add PRIMARY KEY to existing table easily, so skip notion_page_id if missing
				if (col.name === "notion_page_id") {
					log.warn(
						"Table exists but missing notion_page_id column - manual intervention required"
					);
					continue;
				}
				const alterQuery = `ALTER TABLE "${tableName}" ADD COLUMN ${col.def}`;
				await executeRaw(sql, alterQuery);
				result.columnsAdded.push(col.name);
				log.info(`Added special column: ${col.name}`);
			}
		}
	}

	return result;
}
