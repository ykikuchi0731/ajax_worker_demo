/**
 * Notion page property reader and value extractor.
 */

import type { Client } from "@notionhq/client";
import type {
	PageObjectResponse,
	BlockObjectResponse,
} from "@notionhq/client/build/src/api-endpoints";
import { createLogger } from "../log/logger";

const log = createLogger("page-reader");

/**
 * Get all properties from a Notion page.
 */
export async function getPageProperties(
	notion: Client,
	pageId: string
): Promise<PageObjectResponse["properties"]> {
	const page = await notion.pages.retrieve({ page_id: pageId });
	if (!("properties" in page)) {
		throw new Error(`Page ${pageId} is not a full page object`);
	}
	return page.properties;
}

/**
 * Recursively fetch all blocks from a page or block.
 * Handles pagination automatically.
 */
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
			if ("type" in block) {
				const fullBlock = block as BlockObjectResponse;
				blocks.push(fullBlock);

				// Recursively get children if block has children
				if (fullBlock.has_children) {
					const children = await getAllBlocks(notion, fullBlock.id);
					blocks.push(...children);
				}
			}
		}

		cursor = response.has_more ? response.next_cursor ?? undefined : undefined;
	} while (cursor);

	log.info(`Retrieved ${blocks.length} blocks from: ${blockId}`);
	return blocks;
}

/**
 * Extract a plain value from a Notion property object.
 * Handles all supported property types.
 */
export function extractPropertyValue(property: unknown): unknown {
	if (!property || typeof property !== "object") return null;

	const prop = property as Record<string, unknown>;
	const type = prop.type as string;

	switch (type) {
		case "title":
		case "rich_text": {
			const items = prop[type] as Array<{ plain_text: string }> | undefined;
			return items?.map((t) => t.plain_text).join("") ?? "";
		}

		case "number":
			return prop.number ?? null;

		case "select": {
			const select = prop.select as { name: string } | null;
			return select?.name ?? null;
		}

		case "multi_select": {
			const options = prop.multi_select as Array<{ name: string }> | undefined;
			return options?.map((o) => o.name) ?? [];
		}

		case "date": {
			const date = prop.date as { start: string; end?: string } | null;
			return date?.start ?? null;
		}

		case "checkbox":
			return prop.checkbox ?? false;

		case "url":
			return prop.url ?? null;

		case "email":
			return prop.email ?? null;

		case "phone_number":
			return prop.phone_number ?? null;

		case "formula": {
			const formula = prop.formula as Record<string, unknown> | undefined;
			if (!formula) return null;
			// Formula can be string, number, boolean, or date
			return (
				formula.string ?? formula.number ?? formula.boolean ?? formula.date ?? null
			);
		}

		case "relation": {
			const relations = prop.relation as Array<{ id: string }> | undefined;
			return relations?.map((r) => r.id) ?? [];
		}

		case "rollup": {
			const rollup = prop.rollup as Record<string, unknown> | undefined;
			if (!rollup) return null;
			if (rollup.type === "array") {
				// Stringify array rollups
				return JSON.stringify(rollup.array);
			}
			return rollup.number ?? rollup.date ?? null;
		}

		case "created_time":
			return prop.created_time ?? null;

		case "last_edited_time":
			return prop.last_edited_time ?? null;

		case "created_by":
		case "last_edited_by": {
			const user = prop[type] as { id: string } | null;
			return user?.id ?? null;
		}

		case "files": {
			const files = prop.files as
				| Array<{
						file?: { url: string };
						external?: { url: string };
						name?: string;
				  }>
				| undefined;
			return (
				files?.map((f) => f.file?.url ?? f.external?.url).filter(Boolean) ?? []
			);
		}

		case "people": {
			const people = prop.people as Array<{ id: string }> | undefined;
			return people?.map((p) => p.id) ?? [];
		}

		case "status": {
			const status = prop.status as { name: string } | null;
			return status?.name ?? null;
		}

		case "unique_id": {
			const uid = prop.unique_id as {
				prefix: string | null;
				number: number;
			} | null;
			if (!uid) return null;
			return uid.prefix ? `${uid.prefix}-${uid.number}` : String(uid.number);
		}

		default:
			log.warn(`Unknown property type: ${type}`);
			return null;
	}
}
