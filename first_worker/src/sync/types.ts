/**
 * Shared TypeScript types for sync operations.
 */

// Notion property types that we support
export type NotionPropertyType =
	| "title"
	| "rich_text"
	| "number"
	| "select"
	| "multi_select"
	| "date"
	| "checkbox"
	| "url"
	| "email"
	| "phone_number"
	| "formula"
	| "relation"
	| "rollup"
	| "created_time"
	| "created_by"
	| "last_edited_time"
	| "last_edited_by"
	| "files"
	| "people"
	| "status"
	| "unique_id";

// Mapping from property name to its type info
export interface PropertyMapping {
	notionType: NotionPropertyType;
	postgresType: string;
	columnName: string; // Sanitized for Postgres
}

// Schema mapping: property name -> property mapping
export interface SchemaMapping {
	[propertyName: string]: PropertyMapping;
}

// A single record to sync to Postgres
export interface SyncRecord {
	notion_page_id: string;
	page_content: string;
	synced_at: Date;
	properties: Record<string, unknown>;
}

// Sync state for incremental sync (persisted between executions)
export interface SyncState {
	lastSyncTime?: string;
	cursor?: string;
}

// Result of a sync operation
export interface SyncResult {
	processedCount: number;
	errorCount: number;
	errors: string[];
}

// Database table column info from information_schema
export interface TableColumn {
	column_name: string;
	data_type: string;
	is_nullable: string;
}

// Result of schema sync operation
export interface SchemaSyncResult {
	created: boolean;
	columnsAdded: string[];
}

// Options for running sync
export interface SyncOptions {
	databaseId: string;
	pageSize?: number;
}

// Result from runSync function
export interface RunSyncOutput {
	result: SyncResult;
	nextState?: SyncState;
	hasMore: boolean;
}
