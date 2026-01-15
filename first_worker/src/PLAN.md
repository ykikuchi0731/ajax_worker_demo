# Workers that sync between Notion DB and external Postgres DB
- This worker syncs content between Notion DB and external PostgresDB

## How it works
- When a page is created or updated in specified Notion DB, the worker copies or updates corresponding record in external DB
- Notio page content will be sync to additional column "page_content" in external DB in markdown format
  - Upon syncing, only text information is synced. It's OK to drop binary information such as images, videos

## Prerequisite
- Notion DB id will be stored in Secret
- Connection authentication to external DB will be stored in Secret
- The properties in Notion DB matches those of external DB

## Misc
- Create schema sync program that sync Notion DB properties into external DB
  - This program should be called before sync execution
- In this project, we use Neon as external Postgres DB
  - https://neon.com/docs/introduction
- Project ajax modules are internal and its documentation is not publicly available. For reference, read Agents.md and Claude.md in this repository