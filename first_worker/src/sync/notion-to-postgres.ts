/**
 * Main sync logic: orchestrates Notion to Postgres synchronization.
 */

import type { Client } from "@notionhq/client";
import type { SqlClient } from "../db/client";
import type {
	SyncState,
	SyncResult,
	SyncRecord,
	SchemaMapping,
	SyncOptions,
	RunSyncOutput,
} from "./types";
import { fetchNotionSchema, syncSchema, getTableName } from "../db/schema-sync";
import { upsertRecord } from "../db/queries";
import { extractPropertyValue } from "../notion/page-reader";
import { pageToMarkdown } from "../notion/markdown-converter";
import { createLogger } from "../log/logger";

const log = createLogger("sync");

/**
 * Run a single batch of the sync process.
 * Handles schema sync on first run, then processes pages incrementally.
 */
export async function runSync(
	notion: Client,
	sql: SqlClient,
	options: SyncOptions,
	state?: SyncState
): Promise<RunSyncOutput> {
	const { databaseId, pageSize = 100 } = options;
	const tableName = getTableName(databaseId);

	log.info(`Starting sync for database: ${databaseId}, table: ${tableName}`);

	// Step 1: Fetch schema (needed for property extraction)
	const schemaMapping = await fetchNotionSchema(notion, databaseId);

	// Step 2: Sync schema on first run (no state means first run)
	if (!state) {
		const schemaResult = await syncSchema(sql, tableName, schemaMapping);
		if (schemaResult.created) {
			log.info("Created new table");
		} else if (schemaResult.columnsAdded.length > 0) {
			log.info(`Added columns: ${schemaResult.columnsAdded.join(", ")}`);
		}
	}

	// Step 3: Query Notion database with pagination
	const queryParams: Parameters<Client["databases"]["query"]>[0] = {
		database_id: databaseId,
		page_size: pageSize,
		sorts: [{ timestamp: "last_edited_time", direction: "ascending" }],
	};

	// Use cursor for pagination within a sync cycle
	if (state?.cursor) {
		queryParams.start_cursor = state.cursor;
	}
	// Use last sync time filter for incremental sync (new cycle)
	else if (state?.lastSyncTime) {
		queryParams.filter = {
			timestamp: "last_edited_time",
			last_edited_time: { after: state.lastSyncTime },
		};
	}

	const queryResult = await notion.databases.query(queryParams);
	log.info(`Queried ${queryResult.results.length} pages`);

	// Step 4: Process pages
	const result: SyncResult = {
		processedCount: 0,
		errorCount: 0,
		errors: [],
	};

	const columnNames = Object.values(schemaMapping).map((s) => s.columnName);

	for (const page of queryResult.results) {
		if (!("properties" in page)) continue;

		try {
			// Extract property values using schema mapping
			const properties: Record<string, unknown> = {};
			for (const [propName, propDef] of Object.entries(schemaMapping)) {
				const notionProp = page.properties[propName];
				if (notionProp) {
					properties[propDef.columnName] = extractPropertyValue(notionProp);
				}
			}

			// Convert page content to markdown
			const pageContent = await pageToMarkdown(notion, page.id);

			// Build sync record
			const record: SyncRecord = {
				notion_page_id: page.id,
				page_content: pageContent,
				synced_at: new Date(),
				properties,
			};

			// Upsert to Postgres
			await upsertRecord(sql, tableName, record, columnNames);
			result.processedCount++;
		} catch (error) {
			result.errorCount++;
			const errorMsg = `Page ${page.id}: ${error}`;
			result.errors.push(errorMsg);
			log.error(`Failed to sync page: ${errorMsg}`);
		}
	}

	// Step 5: Determine next state for pagination
	const hasMore = queryResult.has_more;
	let nextState: SyncState | undefined;

	if (hasMore && queryResult.next_cursor) {
		// More pages in current query - continue with cursor
		nextState = {
			...state,
			cursor: queryResult.next_cursor,
		};
	} else if (queryResult.results.length > 0) {
		// Finished current batch - save last edited time for next sync cycle
		const lastPage = queryResult.results[queryResult.results.length - 1];
		if ("last_edited_time" in lastPage) {
			nextState = {
				lastSyncTime: lastPage.last_edited_time as string,
				cursor: undefined,
			};
		}
	}

	log.info(
		`Sync batch complete: ${result.processedCount} processed, ${result.errorCount} errors, hasMore: ${hasMore}`
	);

	return { result, nextState, hasMore };
}
