/**
 * Convert Notion page blocks to markdown.
 * Filters out binary content (images, videos, files).
 */

import type { Client } from "@notionhq/client";
import { NotionToMarkdown } from "notion-to-md";
import { createLogger } from "../log/logger";

const log = createLogger("markdown-converter");

// Block types to skip (binary/media content)
const SKIP_TYPES = [
	"image",
	"video",
	"file",
	"pdf",
	"embed",
	"bookmark",
	"link_preview",
	"audio",
] as const;

/**
 * Convert a Notion page to markdown string.
 * Skips binary content like images and videos.
 */
export async function pageToMarkdown(
	notion: Client,
	pageId: string
): Promise<string> {
	const n2m = new NotionToMarkdown({ notionClient: notion });

	// Set custom transformers to skip binary content types
	for (const skipType of SKIP_TYPES) {
		n2m.setCustomTransformer(skipType, () => "");
	}

	try {
		const mdBlocks = await n2m.pageToMarkdown(pageId);
		const mdString = n2m.toMarkdownString(mdBlocks);

		// mdString has { parent: string } structure
		const content = mdString.parent ?? "";

		log.info(`Converted page ${pageId} to markdown (${content.length} chars)`);
		return content;
	} catch (error) {
		log.error(`Failed to convert page ${pageId}: ${error}`);
		return "";
	}
}
