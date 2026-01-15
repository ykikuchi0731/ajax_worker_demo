import { Worker } from "@project-ajax/sdk";
import * as Builder from "@project-ajax/sdk/builder";
import * as Schema from "@project-ajax/sdk/schema";

// Import sync modules
import { getSqlClient } from "./db/client";
import { runSync } from "./sync/notion-to-postgres";
import {
	fetchNotionSchema,
	syncSchema,
	getTableName,
} from "./db/schema-sync";
import { env } from "./env";
import { createLogger } from "./log/logger";
import type { SyncState } from "./sync/types";

const log = createLogger("worker");

const worker = new Worker();
export default worker;

// =============================================================================
// Notion to Postgres Sync
// =============================================================================

/**
 * Sync worker that copies Notion database pages to external Postgres database.
 * - Syncs all page properties to corresponding Postgres columns
 * - Converts page content to markdown and stores in page_content column
 * - Uses incremental sync based on last_edited_time
 */
worker.sync("notionPostgresSync", {
	mode: "incremental",
	primaryKeyProperty: "Page ID",
	schedule: "continuous",
	schema: {
		defaultName: "Notion Postgres Sync",
		databaseIcon: Builder.notionIcon("database"),
		properties: {
			"Page ID": Schema.richText(),
		},
	},
	execute: async (state, { notion }) => {
		log.info("Executing notionPostgresSync");

		try {
			const sql = getSqlClient();
			const syncState = state as SyncState | undefined;

			const { result, nextState, hasMore } = await runSync(
				notion,
				sql,
				{ databaseId: env.NOTION_DATABASE_ID },
				syncState
			);

			log.info(
				`Sync result: ${result.processedCount} synced, ${result.errorCount} errors`
			);

			if (result.errors.length > 0) {
				log.error(`Errors: ${result.errors.join("; ")}`);
			}

			// This sync pushes TO Postgres, not FROM, so we return empty changes
			// The sync tracks its own state via nextState
			return {
				changes: [],
				hasMore,
				nextState,
			};
		} catch (error) {
			log.error(`Sync failed: ${error}`);
			throw error;
		}
	},
});

/**
 * Tool to manually trigger schema synchronization.
 * Run this before the first sync to create/update the Postgres table structure.
 */
worker.tool("syncSchema", {
	title: "Sync Schema",
	description:
		"Synchronize Notion database schema to Postgres table structure. Run before first sync.",
	schema: {
		type: "object",
		properties: {},
		required: [],
		additionalProperties: false,
	},
	execute: async (_input, { notion }) => {
		log.info("Executing syncSchema tool");

		try {
			const sql = getSqlClient();
			const databaseId = env.NOTION_DATABASE_ID;
			const tableName = getTableName(databaseId);

			const schemaMapping = await fetchNotionSchema(notion, databaseId);
			const result = await syncSchema(sql, tableName, schemaMapping);

			const propertyCount = Object.keys(schemaMapping).length;

			if (result.created) {
				return `Created new table "${tableName}" with ${propertyCount} columns from Notion schema.`;
			} else if (result.columnsAdded.length > 0) {
				return `Updated table "${tableName}". Added columns: ${result.columnsAdded.join(", ")}`;
			} else {
				return `Schema is up to date for table "${tableName}" (${propertyCount} columns).`;
			}
		} catch (error) {
			log.error(`Schema sync failed: ${error}`);
			return `Schema sync failed: ${error}`;
		}
	},
});

// =============================================================================
// Sample Demo Workers (from template)
// =============================================================================

const projectId = "project-123";
const projectName = "Project 1";

const sampleTasks = [
	{
		id: "task-1",
		title: "Welcome to Project Ajax",
		status: "Completed",
		description: "This is a simple hello world example",
		projectId,
	},
	{
		id: "task-2",
		title: "Build your first worker",
		status: "In Progress",
		description: "Create a sync or tool worker",
		projectId,
	},
	{
		id: "task-3",
		title: "Deploy to production",
		status: "Todo",
		description: "Share your worker with your team",
		projectId,
	},
];

worker.sync("projectsSync", {
	primaryKeyProperty: "Project ID",
	schema: {
		defaultName: "Projects",
		databaseIcon: Builder.notionIcon("activity"),
		properties: {
			"Project Name": Schema.title(),
			"Project ID": Schema.richText(),
		},
	},
	execute: async () => {
		return {
			changes: [
				{
					type: "upsert" as const,
					key: projectId,
					icon: Builder.notionIcon("activity"),
					properties: {
						"Project Name": Builder.title(projectName),
						"Project ID": Builder.richText(projectId),
					},
				},
			],
			hasMore: false,
		};
	},
});

worker.sync("tasksSync", {
	primaryKeyProperty: "Task ID",
	schedule: "continuous",
	schema: {
		defaultName: "Sample Tasks",
		databaseIcon: Builder.notionIcon("checklist"),
		properties: {
			"Ticket Title": Schema.title(),
			"Task ID": Schema.richText(),
			Description: Schema.richText(),
			Status: Schema.select([
				{ name: "Completed", color: "green" },
				{ name: "In Progress", color: "blue" },
				{ name: "Todo", color: "default" },
			]),
			Project: Schema.relation("projectsSync"),
		},
	},
	execute: async (_state, { notion: _notion }) => {
		const emojiForStatus = (status: string) => {
			switch (status) {
				case "Completed":
					return Builder.notionIcon("checkmark", "green");
				case "In Progress":
					return Builder.notionIcon("arrow-right", "blue");
				case "Todo":
					return Builder.notionIcon("clock", "lightgray");
				default:
					return Builder.notionIcon("question-mark", "lightgray");
			}
		};

		const changes = sampleTasks.map((task) => ({
			type: "upsert" as const,
			key: task.id,
			icon: emojiForStatus(task.status),
			properties: {
				"Ticket Title": Builder.title(task.title),
				"Task ID": Builder.richText(task.id),
				Description: Builder.richText(task.description),
				Status: Builder.select(task.status),
				Project: [Builder.relation(projectId)],
			},
			pageContentMarkdown: `## ${task.title}\n\n${task.description}`,
		}));

		return {
			changes,
			hasMore: false,
			nextState: undefined,
		};
	},
});

type TaskSearchInput = {
	taskId?: string | null;
	query?: string | null;
};

type TaskSearchOutput = {
	count: number;
	tasks: {
		id: string;
		title: string;
		status: string;
		description: string;
	}[];
};

worker.tool<TaskSearchInput, TaskSearchOutput>("taskSearchTool", {
	title: "Task Search",
	description:
		"Look up sample tasks by ID or keyword. Helpful for demonstrating agent tool calls.",
	schema: {
		type: "object",
		properties: {
			taskId: {
				type: "string",
				nullable: true,
				description: "Return a single task that matches the given task ID.",
			},
			query: {
				type: "string",
				nullable: true,
				description:
					"Match search terms against words in the task title or description.",
			},
		},
		required: [],
		additionalProperties: false,
	},
	execute: async (input: TaskSearchInput, { notion: _notion }) => {
		const { taskId, query } = input;

		let matchingTasks = sampleTasks;

		if (taskId) {
			matchingTasks = sampleTasks.filter((task) => task.id === taskId);
		} else if (query) {
			const normalizedQuery = query.trim().toLowerCase();
			const terms = normalizedQuery.split(/\s+/).filter(Boolean);

			if (terms.length > 0) {
				const scoredTasks = sampleTasks
					.map((task) => {
						const title = task.title.toLowerCase();
						const description = task.description.toLowerCase();
						const matches = terms.reduce((count, term) => {
							return title.includes(term) || description.includes(term)
								? count + 1
								: count;
						}, 0);
						return { task, matches };
					})
					.filter(({ matches }) => matches > 0)
					.sort((a, b) => b.matches - a.matches);

				matchingTasks = scoredTasks.map(({ task }) => task);
			} else {
				matchingTasks = [];
			}
		}

		return {
			count: matchingTasks.length,
			tasks: matchingTasks.map((task) => ({
				id: task.id,
				title: task.title,
				status: task.status,
				description: task.description,
			})),
		} satisfies TaskSearchOutput;
	},
});

worker.automation("completeTaskAutomation", {
	title: "Mark Task Complete",
	description: "Automatically marks a task as complete when triggered",
	execute: async (event, { notion: _notion }) => {
		const { pageId, actionType, pageData } = event;

		console.log(`Automation triggered for page: ${pageId}`);
		console.log(`Action type: ${actionType}`);

		if (pageData) {
			console.log("Page properties:", pageData.properties);
		}

		console.log("Task marked as complete!");
	},
});
