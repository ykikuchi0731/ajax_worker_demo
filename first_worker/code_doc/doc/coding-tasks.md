# Coding Tasks Breakdown

## Task 1: Create Environment Module

**File**: `src/env.ts`

**Description**: Centralized environment variable management with runtime validation.

**Implementation**:
```typescript
// Required environment variables with validation
// Throws error if any required variable is missing

const REQUIRED_VARS = ['NEON_DATABASE_URL', 'NOTION_DATABASE_ID'] as const;

function getEnvVar(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const env = {
  NEON_DATABASE_URL: getEnvVar('NEON_DATABASE_URL'),
  NOTION_DATABASE_ID: getEnvVar('NOTION_DATABASE_ID'),
} as const;
```

**Acceptance Criteria**:
- [ ] Exports validated `NEON_DATABASE_URL`
- [ ] Exports validated `NOTION_DATABASE_ID`
- [ ] Throws descriptive error if variable is missing
- [ ] Type-safe exports

---

## Task 2: Create Logging Module

**File**: `src/log/logger.ts`

**Description**: Simple file-based logging utility.

**Implementation**:
```typescript
import * as fs from 'fs';
import * as path from 'path';

const LOG_FILE = path.join(process.cwd(), 'log', 'sync.log');

type LogLevel = 'INFO' | 'WARN' | 'ERROR';

function ensureLogDir(): void {
  const dir = path.dirname(LOG_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function formatMessage(level: LogLevel, module: string, message: string): string {
  const timestamp = new Date().toISOString();
  return `[${timestamp}] [${level}] [${module}] ${message}\n`;
}

export function createLogger(module: string) {
  ensureLogDir();

  return {
    info: (message: string) => {
      fs.appendFileSync(LOG_FILE, formatMessage('INFO', module, message));
    },
    warn: (message: string) => {
      fs.appendFileSync(LOG_FILE, formatMessage('WARN', module, message));
    },
    error: (message: string) => {
      fs.appendFileSync(LOG_FILE, formatMessage('ERROR', module, message));
    },
  };
}
```

**Acceptance Criteria**:
- [ ] Creates `log/` directory if not exists
- [ ] Appends logs to `log/sync.log`
- [ ] Includes timestamp, level, module name
- [ ] Exports `createLogger` factory function

---

## Task 3: Create Type Definitions

**File**: `src/sync/types.ts`

**Description**: Shared TypeScript types for sync operations.

**Implementation**:
```typescript
// Notion property types that we support
export type NotionPropertyType =
  | 'title'
  | 'rich_text'
  | 'number'
  | 'select'
  | 'multi_select'
  | 'date'
  | 'checkbox'
  | 'url'
  | 'email'
  | 'phone_number'
  | 'formula'
  | 'relation'
  | 'rollup'
  | 'created_time'
  | 'created_by'
  | 'last_edited_time'
  | 'last_edited_by'
  | 'files'
  | 'people'
  | 'status'
  | 'unique_id';

// Mapping from property name to its type
export interface SchemaMapping {
  [propertyName: string]: {
    notionType: NotionPropertyType;
    postgresType: string;
    columnName: string; // Sanitized for Postgres
  };
}

// A single record to sync
export interface SyncRecord {
  notion_page_id: string;
  page_content: string;
  synced_at: Date;
  properties: Record<string, unknown>;
}

// Sync state for incremental sync
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

// Database schema info
export interface TableColumn {
  column_name: string;
  data_type: string;
  is_nullable: string;
}
```

**Acceptance Criteria**:
- [ ] Exports all required types
- [ ] Types align with Notion API property types
- [ ] Types align with implementation needs

---

## Task 4: Create Database Client Module

**File**: `src/db/client.ts`

**Description**: Neon Postgres connection wrapper using serverless driver.

**Implementation**:
```typescript
import { neon, NeonQueryFunction } from '@neondatabase/serverless';
import { env } from '../env';
import { createLogger } from '../log/logger';

const log = createLogger('db-client');

let sqlClient: NeonQueryFunction<false, false> | null = null;

export function getSqlClient(): NeonQueryFunction<false, false> {
  if (!sqlClient) {
    log.info('Initializing Neon database connection');
    sqlClient = neon(env.NEON_DATABASE_URL);
  }
  return sqlClient;
}

// Helper for executing queries with error logging
export async function query<T = unknown>(
  sql: NeonQueryFunction<false, false>,
  queryText: string,
  params: unknown[] = []
): Promise<T[]> {
  try {
    const result = await sql(queryText, params);
    return result as T[];
  } catch (error) {
    log.error(`Query failed: ${queryText.substring(0, 100)}... Error: ${error}`);
    throw error;
  }
}
```

**Acceptance Criteria**:
- [ ] Uses `@neondatabase/serverless` driver
- [ ] Reads connection string from `env.ts`
- [ ] Provides reusable SQL client
- [ ] Logs connection initialization
- [ ] Query helper with error logging

---

## Task 5: Create Database Query Functions

**File**: `src/db/queries.ts`

**Description**: CRUD operations for Postgres table.

**Implementation**:
```typescript
import { NeonQueryFunction } from '@neondatabase/serverless';
import { SyncRecord, TableColumn } from '../sync/types';
import { createLogger } from '../log/logger';

const log = createLogger('db-queries');

export async function tableExists(
  sql: NeonQueryFunction<false, false>,
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

export async function getTableColumns(
  sql: NeonQueryFunction<false, false>,
  tableName: string
): Promise<TableColumn[]> {
  return await sql`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ${tableName}
    ORDER BY ordinal_position
  `;
}

export async function upsertRecord(
  sql: NeonQueryFunction<false, false>,
  tableName: string,
  record: SyncRecord,
  columns: string[]
): Promise<void> {
  // Build dynamic upsert query
  const columnNames = ['notion_page_id', 'page_content', 'synced_at', ...columns];
  const values = [
    record.notion_page_id,
    record.page_content,
    record.synced_at.toISOString(),
    ...columns.map(col => record.properties[col])
  ];

  const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');
  const updateSet = columnNames
    .filter(col => col !== 'notion_page_id')
    .map(col => `${col} = EXCLUDED.${col}`)
    .join(', ');

  const query = `
    INSERT INTO ${tableName} (${columnNames.join(', ')})
    VALUES (${placeholders})
    ON CONFLICT (notion_page_id) DO UPDATE SET ${updateSet}
  `;

  await sql(query, values);
  log.info(`Upserted record: ${record.notion_page_id}`);
}

export async function getExistingPageIds(
  sql: NeonQueryFunction<false, false>,
  tableName: string
): Promise<string[]> {
  const result = await sql`
    SELECT notion_page_id FROM ${sql(tableName)}
  `;
  return result.map((row: { notion_page_id: string }) => row.notion_page_id);
}

export async function deleteRecord(
  sql: NeonQueryFunction<false, false>,
  tableName: string,
  pageId: string
): Promise<void> {
  await sql`
    DELETE FROM ${sql(tableName)} WHERE notion_page_id = ${pageId}
  `;
  log.info(`Deleted record: ${pageId}`);
}
```

**Acceptance Criteria**:
- [ ] `tableExists` checks if table exists
- [ ] `getTableColumns` returns current schema
- [ ] `upsertRecord` performs INSERT ON CONFLICT
- [ ] `deleteRecord` removes by page ID
- [ ] All functions log operations

---

## Task 6: Create Schema Sync Module

**File**: `src/db/schema-sync.ts`

**Description**: Synchronize Notion DB schema to Postgres table structure.

**Implementation**:
```typescript
import { Client } from '@notionhq/client';
import { NeonQueryFunction } from '@neondatabase/serverless';
import { SchemaMapping, NotionPropertyType } from '../sync/types';
import { tableExists, getTableColumns } from './queries';
import { createLogger } from '../log/logger';

const log = createLogger('schema-sync');

// Map Notion types to Postgres types
const TYPE_MAP: Record<NotionPropertyType, string> = {
  title: 'TEXT NOT NULL',
  rich_text: 'TEXT',
  number: 'NUMERIC',
  select: 'TEXT',
  multi_select: 'TEXT[]',
  date: 'TIMESTAMPTZ',
  checkbox: 'BOOLEAN',
  url: 'TEXT',
  email: 'TEXT',
  phone_number: 'TEXT',
  formula: 'TEXT',
  relation: 'TEXT[]',
  rollup: 'TEXT',
  created_time: 'TIMESTAMPTZ',
  created_by: 'TEXT',
  last_edited_time: 'TIMESTAMPTZ',
  last_edited_by: 'TEXT',
  files: 'TEXT[]',
  people: 'TEXT[]',
  status: 'TEXT',
  unique_id: 'TEXT',
};

// Sanitize column name for Postgres
function sanitizeColumnName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_');
}

export async function fetchNotionSchema(
  notion: Client,
  databaseId: string
): Promise<SchemaMapping> {
  log.info(`Fetching schema for database: ${databaseId}`);

  const db = await notion.databases.retrieve({ database_id: databaseId });
  const mapping: SchemaMapping = {};

  for (const [propName, propDef] of Object.entries(db.properties)) {
    const notionType = propDef.type as NotionPropertyType;
    if (TYPE_MAP[notionType]) {
      mapping[propName] = {
        notionType,
        postgresType: TYPE_MAP[notionType],
        columnName: sanitizeColumnName(propName),
      };
    } else {
      log.warn(`Unsupported property type: ${notionType} for property: ${propName}`);
    }
  }

  return mapping;
}

export async function syncSchema(
  sql: NeonQueryFunction<false, false>,
  tableName: string,
  schema: SchemaMapping
): Promise<{ created: boolean; columnsAdded: string[] }> {
  const result = { created: false, columnsAdded: [] as string[] };

  // Check if table exists
  const exists = await tableExists(sql, tableName);

  if (!exists) {
    // Create table
    const columnDefs = [
      'notion_page_id TEXT PRIMARY KEY',
      'page_content TEXT',
      'synced_at TIMESTAMPTZ DEFAULT NOW()',
      ...Object.values(schema).map(
        s => `${s.columnName} ${s.postgresType.replace(' NOT NULL', '')}`
      ),
    ];

    const createQuery = `CREATE TABLE ${tableName} (${columnDefs.join(', ')})`;
    await sql(createQuery);

    log.info(`Created table: ${tableName}`);
    result.created = true;
  } else {
    // Get existing columns
    const existingCols = await getTableColumns(sql, tableName);
    const existingNames = new Set(existingCols.map(c => c.column_name));

    // Add missing columns
    for (const prop of Object.values(schema)) {
      if (!existingNames.has(prop.columnName)) {
        const alterQuery = `ALTER TABLE ${tableName} ADD COLUMN ${prop.columnName} ${prop.postgresType.replace(' NOT NULL', '')}`;
        await sql(alterQuery);
        result.columnsAdded.push(prop.columnName);
        log.info(`Added column: ${prop.columnName}`);
      }
    }

    // Ensure special columns exist
    const specialCols = ['notion_page_id', 'page_content', 'synced_at'];
    for (const col of specialCols) {
      if (!existingNames.has(col)) {
        let colDef = '';
        switch (col) {
          case 'notion_page_id':
            colDef = 'notion_page_id TEXT PRIMARY KEY';
            break;
          case 'page_content':
            colDef = 'page_content TEXT';
            break;
          case 'synced_at':
            colDef = 'synced_at TIMESTAMPTZ DEFAULT NOW()';
            break;
        }
        await sql(`ALTER TABLE ${tableName} ADD COLUMN ${colDef}`);
        result.columnsAdded.push(col);
      }
    }
  }

  return result;
}
```

**Acceptance Criteria**:
- [ ] `fetchNotionSchema` retrieves database properties
- [ ] Maps Notion types to Postgres types correctly
- [ ] `syncSchema` creates table if not exists
- [ ] `syncSchema` adds missing columns to existing table
- [ ] Column names are sanitized for Postgres
- [ ] Special columns (notion_page_id, page_content, synced_at) always present

---

## Task 7: Create Page Reader Module

**File**: `src/notion/page-reader.ts`

**Description**: Read Notion page properties and blocks.

**Implementation**:
```typescript
import { Client } from '@notionhq/client';
import {
  PageObjectResponse,
  BlockObjectResponse,
  PartialBlockObjectResponse,
} from '@notionhq/client/build/src/api-endpoints';
import { createLogger } from '../log/logger';

const log = createLogger('page-reader');

export async function getPageProperties(
  notion: Client,
  pageId: string
): Promise<PageObjectResponse['properties']> {
  const page = await notion.pages.retrieve({ page_id: pageId });
  if (!('properties' in page)) {
    throw new Error(`Page ${pageId} is not a full page object`);
  }
  return page.properties;
}

export async function getAllBlocks(
  notion: Client,
  blockId: string
): Promise<BlockObjectResponse[]> {
  const blocks: BlockObjectResponse[] = [];
  let cursor: string | undefined;

  do {
    const response = await notion.blocks.children.list({
      block_id: blockId,
      start_cursor: cursor,
      page_size: 100,
    });

    for (const block of response.results) {
      if ('type' in block) {
        blocks.push(block as BlockObjectResponse);

        // Recursively get children if block has children
        if (block.has_children) {
          const children = await getAllBlocks(notion, block.id);
          blocks.push(...children);
        }
      }
    }

    cursor = response.has_more ? response.next_cursor ?? undefined : undefined;
  } while (cursor);

  log.info(`Retrieved ${blocks.length} blocks from page: ${blockId}`);
  return blocks;
}

// Extract text value from various Notion property types
export function extractPropertyValue(property: unknown): unknown {
  if (!property || typeof property !== 'object') return null;

  const prop = property as Record<string, unknown>;
  const type = prop.type as string;

  switch (type) {
    case 'title':
    case 'rich_text': {
      const items = prop[type] as Array<{ plain_text: string }>;
      return items?.map(t => t.plain_text).join('') ?? '';
    }
    case 'number':
      return prop.number;
    case 'select':
      return (prop.select as { name: string } | null)?.name ?? null;
    case 'multi_select': {
      const options = prop.multi_select as Array<{ name: string }>;
      return options?.map(o => o.name) ?? [];
    }
    case 'date': {
      const date = prop.date as { start: string } | null;
      return date?.start ?? null;
    }
    case 'checkbox':
      return prop.checkbox;
    case 'url':
      return prop.url;
    case 'email':
      return prop.email;
    case 'phone_number':
      return prop.phone_number;
    case 'formula': {
      const formula = prop.formula as Record<string, unknown>;
      return formula?.string ?? formula?.number ?? formula?.boolean ?? null;
    }
    case 'relation': {
      const relations = prop.relation as Array<{ id: string }>;
      return relations?.map(r => r.id) ?? [];
    }
    case 'rollup': {
      const rollup = prop.rollup as Record<string, unknown>;
      if (rollup.type === 'array') {
        return JSON.stringify(rollup.array);
      }
      return rollup.number ?? rollup.date ?? null;
    }
    case 'created_time':
      return prop.created_time;
    case 'last_edited_time':
      return prop.last_edited_time;
    case 'created_by':
    case 'last_edited_by': {
      const user = prop[type] as { id: string } | null;
      return user?.id ?? null;
    }
    case 'files': {
      const files = prop.files as Array<{ file?: { url: string }; external?: { url: string } }>;
      return files?.map(f => f.file?.url ?? f.external?.url).filter(Boolean) ?? [];
    }
    case 'people': {
      const people = prop.people as Array<{ id: string }>;
      return people?.map(p => p.id) ?? [];
    }
    case 'status':
      return (prop.status as { name: string } | null)?.name ?? null;
    case 'unique_id': {
      const uid = prop.unique_id as { prefix: string | null; number: number };
      return uid ? `${uid.prefix ?? ''}${uid.number}` : null;
    }
    default:
      log.warn(`Unknown property type: ${type}`);
      return null;
  }
}
```

**Acceptance Criteria**:
- [ ] `getPageProperties` retrieves all properties
- [ ] `getAllBlocks` handles pagination
- [ ] `getAllBlocks` fetches nested blocks recursively
- [ ] `extractPropertyValue` handles all supported property types
- [ ] Logs block count after retrieval

---

## Task 8: Create Markdown Converter Module

**File**: `src/notion/markdown-converter.ts`

**Description**: Convert Notion blocks to markdown, filtering binary content.

**Implementation**:
```typescript
import { Client } from '@notionhq/client';
import { NotionToMarkdown } from 'notion-to-md';
import { createLogger } from '../log/logger';

const log = createLogger('markdown-converter');

// Block types to skip (binary/media content)
const SKIP_TYPES = new Set([
  'image',
  'video',
  'file',
  'pdf',
  'embed',
  'bookmark',
  'link_preview',
  'audio',
]);

export async function pageToMarkdown(
  notion: Client,
  pageId: string
): Promise<string> {
  const n2m = new NotionToMarkdown({ notionClient: notion });

  // Set custom transformer to skip binary content
  for (const skipType of SKIP_TYPES) {
    n2m.setCustomTransformer(skipType, () => '');
  }

  try {
    const mdBlocks = await n2m.pageToMarkdown(pageId);
    const mdString = n2m.toMarkdownString(mdBlocks);

    log.info(`Converted page ${pageId} to markdown (${mdString.parent.length} chars)`);
    return mdString.parent;
  } catch (error) {
    log.error(`Failed to convert page ${pageId}: ${error}`);
    return '';
  }
}
```

**Acceptance Criteria**:
- [ ] Uses `notion-to-md` library
- [ ] Skips image, video, file, pdf, embed, audio blocks
- [ ] Returns empty string on conversion error
- [ ] Logs conversion result or error

---

## Task 9: Create Main Sync Logic Module

**File**: `src/sync/notion-to-postgres.ts`

**Description**: Orchestrate the complete sync process.

**Implementation**:
```typescript
import { Client } from '@notionhq/client';
import { NeonQueryFunction } from '@neondatabase/serverless';
import { SyncState, SyncResult, SyncRecord, SchemaMapping } from './types';
import { fetchNotionSchema, syncSchema } from '../db/schema-sync';
import { upsertRecord } from '../db/queries';
import { extractPropertyValue } from '../notion/page-reader';
import { pageToMarkdown } from '../notion/markdown-converter';
import { createLogger } from '../log/logger';

const log = createLogger('sync');

// Derive table name from database ID
function getTableName(databaseId: string): string {
  return `notion_${databaseId.replace(/-/g, '_').substring(0, 20)}`;
}

export interface SyncOptions {
  databaseId: string;
  pageSize?: number;
}

export async function runSync(
  notion: Client,
  sql: NeonQueryFunction<false, false>,
  options: SyncOptions,
  state?: SyncState
): Promise<{ result: SyncResult; nextState?: SyncState; hasMore: boolean }> {
  const { databaseId, pageSize = 100 } = options;
  const tableName = getTableName(databaseId);

  log.info(`Starting sync for database: ${databaseId}`);

  // Step 1: Sync schema on first run (no state)
  let schemaMapping: SchemaMapping;
  if (!state) {
    schemaMapping = await fetchNotionSchema(notion, databaseId);
    const schemaResult = await syncSchema(sql, tableName, schemaMapping);
    if (schemaResult.created) {
      log.info('Created new table');
    } else if (schemaResult.columnsAdded.length > 0) {
      log.info(`Added columns: ${schemaResult.columnsAdded.join(', ')}`);
    }
  } else {
    // Fetch schema for property extraction
    schemaMapping = await fetchNotionSchema(notion, databaseId);
  }

  // Step 2: Query Notion database
  const queryParams: Parameters<Client['databases']['query']>[0] = {
    database_id: databaseId,
    page_size: pageSize,
    sorts: [{ timestamp: 'last_edited_time', direction: 'ascending' }],
  };

  // Use cursor for pagination
  if (state?.cursor) {
    queryParams.start_cursor = state.cursor;
  }
  // Filter by last sync time for incremental sync
  else if (state?.lastSyncTime) {
    queryParams.filter = {
      timestamp: 'last_edited_time',
      last_edited_time: { after: state.lastSyncTime },
    };
  }

  const queryResult = await notion.databases.query(queryParams);

  // Step 3: Process pages
  const result: SyncResult = {
    processedCount: 0,
    errorCount: 0,
    errors: [],
  };

  const columnNames = Object.values(schemaMapping).map(s => s.columnName);

  for (const page of queryResult.results) {
    if (!('properties' in page)) continue;

    try {
      // Extract properties
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
      result.errors.push(`Page ${page.id}: ${error}`);
      log.error(`Failed to sync page ${page.id}: ${error}`);
    }
  }

  // Step 4: Determine next state
  const hasMore = queryResult.has_more;
  let nextState: SyncState | undefined;

  if (hasMore && queryResult.next_cursor) {
    nextState = {
      ...state,
      cursor: queryResult.next_cursor,
    };
  } else if (queryResult.results.length > 0) {
    // Save last edited time for next sync cycle
    const lastPage = queryResult.results[queryResult.results.length - 1];
    if ('last_edited_time' in lastPage) {
      nextState = {
        lastSyncTime: lastPage.last_edited_time as string,
      };
    }
  }

  log.info(`Sync batch complete: ${result.processedCount} processed, ${result.errorCount} errors`);

  return { result, nextState, hasMore };
}
```

**Acceptance Criteria**:
- [ ] Runs schema sync on first execution
- [ ] Queries Notion with pagination
- [ ] Supports incremental sync with last_edited_time filter
- [ ] Extracts properties and converts to Postgres-compatible values
- [ ] Converts page content to markdown
- [ ] Upserts records to Postgres
- [ ] Returns proper hasMore and nextState for pagination
- [ ] Tracks errors without stopping sync

---

## Task 10: Update Worker Entry Point

**File**: `src/index.ts`

**Description**: Register sync and tool capabilities.

**Changes**:
1. Remove or keep existing sample syncs (optional)
2. Add `notionPostgresSync` sync capability
3. Add `syncSchema` tool capability
4. Import required modules

**Implementation to Add**:
```typescript
import { getSqlClient } from './db/client';
import { runSync } from './sync/notion-to-postgres';
import { fetchNotionSchema, syncSchema } from './db/schema-sync';
import { env } from './env';
import { createLogger } from './log/logger';

const log = createLogger('worker');

// Notion to Postgres Sync
worker.sync("notionPostgresSync", {
  mode: "incremental",
  primaryKeyProperty: "notion_page_id",
  schedule: "continuous",
  schema: {
    defaultName: "Notion Postgres Sync",
    databaseIcon: Builder.notionIcon("database"),
    properties: {
      "Page ID": Schema.richText(),
      "notion_page_id": Schema.richText(),
    },
  },
  execute: async (state, { notion }) => {
    log.info('Executing notionPostgresSync');

    const sql = getSqlClient();
    const { result, nextState, hasMore } = await runSync(
      notion,
      sql,
      { databaseId: env.NOTION_DATABASE_ID },
      state as { lastSyncTime?: string; cursor?: string } | undefined
    );

    log.info(`Sync result: ${result.processedCount} synced, ${result.errorCount} errors`);

    // Return changes (empty since we're syncing TO postgres, not FROM)
    return {
      changes: [],
      hasMore,
      nextState,
    };
  },
});

// Schema Sync Tool
worker.tool("syncSchema", {
  title: "Sync Schema",
  description: "Synchronize Notion database schema to Postgres table structure",
  schema: {
    type: "object",
    properties: {},
    required: [],
    additionalProperties: false,
  },
  execute: async (_input, { notion }) => {
    log.info('Executing syncSchema tool');

    const sql = getSqlClient();
    const databaseId = env.NOTION_DATABASE_ID;
    const tableName = `notion_${databaseId.replace(/-/g, '_').substring(0, 20)}`;

    const schemaMapping = await fetchNotionSchema(notion, databaseId);
    const result = await syncSchema(sql, tableName, schemaMapping);

    if (result.created) {
      return `Created new table: ${tableName}`;
    } else if (result.columnsAdded.length > 0) {
      return `Added columns to ${tableName}: ${result.columnsAdded.join(', ')}`;
    } else {
      return `Schema is up to date for table: ${tableName}`;
    }
  },
});
```

**Acceptance Criteria**:
- [ ] `notionPostgresSync` registered with incremental mode
- [ ] `syncSchema` tool registered
- [ ] Uses env module for database ID
- [ ] Uses db client for Postgres connection
- [ ] Proper logging throughout

---

## Task 11: Install Dependencies

**Command**:
```bash
npm install @neondatabase/serverless notion-to-md
```

**package.json additions**:
```json
{
  "dependencies": {
    "@neondatabase/serverless": "^0.10.0",
    "notion-to-md": "^3.1.0"
  }
}
```

**Acceptance Criteria**:
- [ ] `@neondatabase/serverless` installed
- [ ] `notion-to-md` installed
- [ ] No version conflicts

---

## Task 12: Validate Implementation

**Steps**:
1. Run type check: `npm run check`
2. Fix any TypeScript errors
3. Test locally: `npm run dev`
4. Deploy: `npx workers deploy`
5. Execute schema sync: `npx workers exec syncSchema`
6. Execute sync: `npx workers exec notionPostgresSync`

**Acceptance Criteria**:
- [ ] No TypeScript errors
- [ ] Schema sync creates/updates table correctly
- [ ] Sync processes pages without errors
- [ ] Postgres table contains synced data

---

## Summary: File Creation Order

1. `src/env.ts`
2. `src/log/logger.ts`
3. `src/sync/types.ts`
4. `src/db/client.ts`
5. `src/db/queries.ts`
6. `src/db/schema-sync.ts`
7. `src/notion/page-reader.ts`
8. `src/notion/markdown-converter.ts`
9. `src/sync/notion-to-postgres.ts`
10. Update `src/index.ts`
11. Update `package.json` (install dependencies)
12. Validate and test
