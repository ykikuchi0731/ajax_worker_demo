# Implementation Plan: Notion DB to External Postgres Sync Worker

## Overview

This worker provides bidirectional-style sync between a Notion database and an external Neon Postgres database. When pages are created or updated in the specified Notion DB, the worker copies or updates corresponding records in the external Postgres database, including page content in markdown format.

---

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   Notion DB     │────>│  Ajax Worker     │────>│  Neon Postgres  │
│   (Source)      │     │  (Sync Engine)   │     │  (Target)       │
└─────────────────┘     └──────────────────┘     └─────────────────┘
                               │
                               ▼
                        ┌──────────────────┐
                        │  Schema Sync     │
                        │  (Pre-execution) │
                        └──────────────────┘
```

---

## Module Structure

```
src/
├── index.ts                 # Worker entry point with sync/automation definitions
├── env.ts                   # Environment variable management
├── db/
│   ├── client.ts            # Neon Postgres client wrapper
│   ├── schema-sync.ts       # Schema synchronization logic
│   └── queries.ts           # Database query functions
├── notion/
│   ├── page-reader.ts       # Notion page content reader
│   └── markdown-converter.ts # Convert Notion blocks to markdown
├── sync/
│   ├── notion-to-postgres.ts # Main sync logic
│   └── types.ts             # Shared type definitions
└── log/
    └── logger.ts            # Logging utility
```

---

## Implementation Tasks

### Phase 1: Foundation Setup

#### Task 1.1: Create Environment Module (`src/env.ts`)
**Purpose**: Centralized environment variable management with validation

**Required Environment Variables**:
- `NEON_DATABASE_URL` - Neon Postgres connection string
- `NOTION_DATABASE_ID` - Target Notion database ID

**Implementation**:
- Export validated environment variables
- Throw runtime error if required variables are missing
- Type-safe access to all env vars

---

#### Task 1.2: Create Logging Module (`src/log/logger.ts`)
**Purpose**: Structured logging to file

**Features**:
- Log to `log/sync.log` file
- Log levels: info, warn, error
- Timestamp each entry
- Module context prefix

---

#### Task 1.3: Create Database Client Module (`src/db/client.ts`)
**Purpose**: Neon Postgres connection wrapper

**Implementation**:
```typescript
// Use @neondatabase/serverless
import { neon } from '@neondatabase/serverless';
```

**Features**:
- Export configured sql client
- Handle connection errors gracefully
- Support for parameterized queries

---

### Phase 2: Schema Synchronization

#### Task 2.1: Create Type Definitions (`src/sync/types.ts`)
**Purpose**: Shared TypeScript types

**Types to Define**:
- `NotionPropertyType` - Enum of Notion property types
- `PostgresColumnType` - Mapped Postgres column types
- `SyncRecord` - Record structure for sync operations
- `SchemaMapping` - Notion property to Postgres column mapping

---

#### Task 2.2: Create Schema Sync Module (`src/db/schema-sync.ts`)
**Purpose**: Synchronize Notion DB schema to Postgres table

**Flow**:
1. Fetch Notion database schema using SDK
2. Map Notion property types to Postgres column types:
   - `title` → `TEXT NOT NULL`
   - `rich_text` → `TEXT`
   - `number` → `NUMERIC`
   - `select` → `TEXT`
   - `multi_select` → `TEXT[]`
   - `date` → `TIMESTAMPTZ`
   - `checkbox` → `BOOLEAN`
   - `url` → `TEXT`
   - `email` → `TEXT`
   - `phone_number` → `TEXT`
   - `formula` → `TEXT` (store computed result)
   - `relation` → `TEXT[]` (store related page IDs)
   - `rollup` → `TEXT` (store computed result)
   - `created_time` → `TIMESTAMPTZ`
   - `last_edited_time` → `TIMESTAMPTZ`
   - `created_by` → `TEXT`
   - `last_edited_by` → `TEXT`
   - `files` → `TEXT[]` (store URLs)
3. Add special columns:
   - `notion_page_id TEXT PRIMARY KEY` - Notion page ID
   - `page_content TEXT` - Markdown content
   - `synced_at TIMESTAMPTZ` - Last sync timestamp
4. Create or alter table to match schema
5. Handle schema changes (add new columns, alter types if safe)

**Postgres Type Mapping Reference**:
```typescript
const typeMapping: Record<string, string> = {
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
```

---

### Phase 3: Notion Content Extraction

#### Task 3.1: Create Page Reader Module (`src/notion/page-reader.ts`)
**Purpose**: Read Notion page properties and content

**Implementation**:
- Use Notion SDK from worker context (`context.notion`)
- Fetch page properties
- Fetch all blocks recursively
- Handle pagination for large pages

**Key Functions**:
```typescript
async function getPageProperties(notion: Client, pageId: string): Promise<PropertyValues>
async function getPageBlocks(notion: Client, pageId: string): Promise<BlockObjectResponse[]>
```

---

#### Task 3.2: Create Markdown Converter Module (`src/notion/markdown-converter.ts`)
**Purpose**: Convert Notion blocks to markdown

**Implementation**:
- Use `notion-to-md` library for conversion
- Filter out binary content (images, videos, files)
- Handle nested blocks
- Return clean markdown string

**Dependency**: Add `notion-to-md` to package.json

**Key Functions**:
```typescript
async function blocksToMarkdown(notion: Client, pageId: string): Promise<string>
```

**Block Type Handling**:
- Text blocks → Convert to markdown
- Headings → `#`, `##`, `###`
- Lists → `-`, `1.`
- Code blocks → Fenced code blocks
- Quotes → `>`
- Dividers → `---`
- Tables → Markdown tables
- **Skip**: Images, videos, files, embeds (binary content)

---

### Phase 4: Database Operations

#### Task 4.1: Create Query Functions Module (`src/db/queries.ts`)
**Purpose**: CRUD operations for Postgres

**Key Functions**:
```typescript
async function upsertRecord(sql: NeonClient, tableName: string, record: SyncRecord): Promise<void>
async function deleteRecord(sql: NeonClient, tableName: string, pageId: string): Promise<void>
async function getExistingRecords(sql: NeonClient, tableName: string): Promise<string[]>
async function tableExists(sql: NeonClient, tableName: string): Promise<boolean>
```

**Upsert Strategy**:
- Use `INSERT ... ON CONFLICT (notion_page_id) DO UPDATE`
- Update all columns on conflict
- Set `synced_at` to current timestamp

---

### Phase 5: Main Sync Implementation

#### Task 5.1: Create Sync Logic Module (`src/sync/notion-to-postgres.ts`)
**Purpose**: Orchestrate the sync process

**Flow**:
1. Run schema sync first (ensure table exists with correct schema)
2. Query Notion database for pages (with pagination)
3. For each page:
   - Extract property values
   - Convert page content to markdown
   - Upsert to Postgres
4. Track sync state for incremental syncs

**Key Functions**:
```typescript
async function syncNotionToPostgres(
  notion: Client,
  sql: NeonClient,
  databaseId: string,
  state?: SyncState
): Promise<SyncResult>
```

---

#### Task 5.2: Update Worker Entry Point (`src/index.ts`)
**Purpose**: Register sync capability with the worker

**Implementation**:
- Create `notionPostgresSync` sync capability
- Use `mode: 'incremental'` for efficiency
- Implement pagination with `last_edited_time` cursor
- Call schema sync on first execution
- Handle errors gracefully

**Sync Configuration**:
```typescript
worker.sync("notionPostgresSync", {
  mode: "incremental",
  primaryKeyProperty: "notion_page_id",
  schedule: "continuous",
  schema: {
    defaultName: "Notion Postgres Sync",
    properties: {
      // Dynamic based on Notion DB schema
    }
  },
  execute: async (state, { notion }) => {
    // Implementation
  }
});
```

---

### Phase 6: Schema Sync Tool

#### Task 6.1: Create Schema Sync Tool
**Purpose**: Manual schema sync capability

**Implementation**:
- Register as a worker tool
- Can be called before sync execution
- Reports schema changes made

```typescript
worker.tool("syncSchema", {
  title: "Sync Schema",
  description: "Synchronize Notion DB schema to Postgres table",
  execute: async (input, { notion }) => {
    // Run schema sync
    // Return report of changes
  }
});
```

---

## Dependencies to Add

```json
{
  "dependencies": {
    "@neondatabase/serverless": "^0.10.0",
    "notion-to-md": "^3.1.0"
  }
}
```

---

## Environment Variables (Secrets)

| Variable | Description | Example |
|----------|-------------|---------|
| `NEON_DATABASE_URL` | Neon Postgres connection string | `postgres://user:pass@host/db` |
| `NOTION_DATABASE_ID` | Notion database ID to sync | `abc123...` |

---

## Error Handling Strategy

1. **Connection Errors**: Log and retry with exponential backoff
2. **Schema Mismatch**: Log warning, skip incompatible columns
3. **Page Access Errors**: Log error, continue with other pages
4. **Markdown Conversion Errors**: Log warning, store empty content
5. **Database Write Errors**: Log error, include in sync result

---

## Logging Strategy

Log file: `log/sync.log`

**Log Events**:
- Sync started/completed
- Schema sync changes
- Pages processed (count)
- Errors encountered
- Performance metrics (duration, records synced)

---

## Testing Strategy

1. **Type Check**: `npm run check`
2. **Local Development**: `npm run dev`
3. **Deploy & Execute**:
   ```bash
   npx workers deploy
   npx workers exec syncSchema
   npx workers exec notionPostgresSync
   ```

---

## Implementation Order

1. `src/env.ts` - Environment management
2. `src/log/logger.ts` - Logging utility
3. `src/sync/types.ts` - Type definitions
4. `src/db/client.ts` - Database client
5. `src/db/queries.ts` - Database queries
6. `src/db/schema-sync.ts` - Schema synchronization
7. `src/notion/page-reader.ts` - Page content reader
8. `src/notion/markdown-converter.ts` - Markdown conversion
9. `src/sync/notion-to-postgres.ts` - Main sync logic
10. `src/index.ts` - Worker registration (update)
11. Install dependencies
12. Test and validate
