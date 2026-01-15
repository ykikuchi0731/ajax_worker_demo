/**
 * Environment variable management with Zod validation.
 * All modules MUST use this module to access environment variables.
 */

import { z } from "zod";

/**
 * Schema for environment variables.
 * - Required variables will cause validation to fail if missing
 * - Optional variables have defaults
 */
const envSchema = z.object({
	// Required: Notion API Integration Token (used by @project-ajax/sdk)
	// Get from https://www.notion.so/my-integrations
	NOTION_API_TOKEN: z
		.string({ error: "NOTION_API_TOKEN must be a string" })
		.min(1, { error: "NOTION_API_TOKEN is required" }),

	// Required: Notion database ID to sync
	NOTION_DATABASE_ID: z
		.string({ error: "NOTION_DATABASE_ID must be a string" })
		.min(1, { error: "NOTION_DATABASE_ID is required" })
		.regex(/^[a-f0-9-]{32,36}$/i, {
			error: "NOTION_DATABASE_ID must be a valid UUID format",
		}),

	// Required: Neon Postgres connection string
	NEON_DATABASE_URL: z
		.string({ error: "NEON_DATABASE_URL must be a string" })
		.min(1, { error: "NEON_DATABASE_URL is required" })
		.startsWith("postgres", { error: "NEON_DATABASE_URL must be a postgres:// URL" }),

	// Optional: Log level with default
	LOG_LEVEL: z
		.enum(["DEBUG", "INFO", "WARN", "ERROR"])
		.default("INFO"),
});

/**
 * Inferred type from the schema
 */
export type Env = z.infer<typeof envSchema>;

/**
 * Parse and validate environment variables.
 * Uses safeParse to provide detailed error messages.
 */
function parseEnv(): Env {
	const result = envSchema.safeParse({
		NOTION_API_TOKEN: process.env.NOTION_API_TOKEN,
		NOTION_DATABASE_ID: process.env.NOTION_DATABASE_ID,
		NEON_DATABASE_URL: process.env.NEON_DATABASE_URL,
		LOG_LEVEL: process.env.LOG_LEVEL,
	});

	if (!result.success) {
		const errors = result.error.issues
			.map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
			.join("\n");

		throw new Error(`Environment validation failed:\n${errors}`);
	}

	return result.data;
}

/**
 * Lazy-loaded validated environment variables.
 * Validation runs on first access to avoid errors during module import.
 */
let cachedEnv: Env | null = null;

export const env = new Proxy({} as Env, {
	get(_target, prop: string) {
		if (!cachedEnv) {
			cachedEnv = parseEnv();
		}
		return cachedEnv[prop as keyof Env];
	},
});

/**
 * Explicitly validate environment variables.
 * Call this early in application startup to fail fast.
 */
export function validateEnv(): Env {
	if (!cachedEnv) {
		cachedEnv = parseEnv();
	}
	return cachedEnv;
}
