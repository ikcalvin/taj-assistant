/**
 * TAJ Knowledge Base Ingestion Script
 *
 * Reads PDF and Markdown files from a directory, chunks them with
 * hierarchical context (document title + section heading), and upserts
 * them into a namespaced Pinecone index using integrated inference
 * (llama-text-embed-v2 handles embedding on Pinecone's side).
 *
 * Usage:
 *   npx tsx --env-file=.env src/scripts/ingest.ts ./docs/tax --namespace tax
 *   npx tsx --env-file=.env src/scripts/ingest.ts ./docs/trn --namespace trn
 *   npx tsx --env-file=.env src/scripts/ingest.ts ./docs/motor-vehicle --namespace motor-vehicle
 *
 * Environment variables required:
 *   PINECONE_API_KEY - Your Pinecone API key
 */

import { Pinecone } from '@pinecone-database/pinecone';
import { MDocument } from '@mastra/rag';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { TextItem, TextMarkedContent } from 'pdfjs-dist/types/src/display/api';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

// Set up pdfjs-dist worker for Node.js (requires file:// URL on Windows)
const require = createRequire(import.meta.url);
const workerPath = require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs');
GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href;

const INDEX_NAME = 'taj-knowledge';
const BATCH_SIZE = 96; // Pinecone's limit for integrated inference upserts

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

function parseArgs(): { docsDir: string; namespace: string | undefined } {
  const args = process.argv.slice(2);
  let docsDir: string | undefined;
  let namespace: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--namespace' && i + 1 < args.length) {
      namespace = args[i + 1];
      i++; // skip next arg
    } else if (!docsDir) {
      docsDir = args[i];
    }
  }

  if (!docsDir) {
    console.error(
      'Usage: npx tsx --env-file=.env src/scripts/ingest.ts ./path/to/documents/ [--namespace <name>]',
    );
    process.exit(1);
  }

  return { docsDir, namespace };
}

// ---------------------------------------------------------------------------
// PDF helpers
// ---------------------------------------------------------------------------

function isTextItem(item: TextItem | TextMarkedContent): item is TextItem {
  return 'str' in item && typeof item.str === 'string';
}

/**
 * Extract text from a PDF buffer, returning an array of per-page strings.
 */
async function extractPdfPages(buffer: Buffer): Promise<string[]> {
  const data = new Uint8Array(buffer);
  const doc = await getDocument({ data, useSystemFonts: true }).promise;
  const pages: string[] = [];

  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items
      .filter(isTextItem)
      .map((item) => item.str)
      .join(' ');
    pages.push(pageText);
  }

  return pages;
}

// ---------------------------------------------------------------------------
// Section heading extraction
// ---------------------------------------------------------------------------

/**
 * Very simple heuristic: lines that look like headings
 * (short, possibly prefixed with #, or ALL CAPS, or numbered like "1." / "Step 3")
 */
function extractNearestHeading(text: string): string {
  const lines = text.split('\n');
  let lastHeading = '';

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Markdown headings
    if (/^#{1,4}\s+/.test(trimmed)) {
      lastHeading = trimmed.replace(/^#{1,4}\s+/, '').trim();
      continue;
    }

    // ALL CAPS lines (likely section titles in PDFs)
    if (trimmed.length < 80 && trimmed === trimmed.toUpperCase() && /[A-Z]/.test(trimmed)) {
      lastHeading = trimmed;
      continue;
    }

    // Numbered step patterns: "Step 3 —", "1.", "1)"
    if (/^(step\s+\d+|[\d]+[.)]\s)/i.test(trimmed) && trimmed.length < 100) {
      lastHeading = trimmed;
      continue;
    }
  }

  return lastHeading;
}

/**
 * Derive a human-friendly document title from the filename.
 */
function fileNameToTitle(filename: string): string {
  return filename
    .replace(/\.(pdf|md|txt)$/i, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const { docsDir, namespace } = parseArgs();

  if (!process.env.PINECONE_API_KEY) {
    console.error('Error: PINECONE_API_KEY environment variable is not set.');
    process.exit(1);
  }

  const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });

  // 1. Create index with integrated inference if it doesn't exist
  console.log(`Ensuring Pinecone index "${INDEX_NAME}" exists...`);
  try {
    await pc.createIndexForModel({
      name: INDEX_NAME,
      cloud: 'aws',
      region: 'us-east-1',
      embed: {
        model: 'llama-text-embed-v2',
        fieldMap: { text: 'text' },
      },
      waitUntilReady: true,
      suppressConflicts: true,
    });
    console.log(`Index "${INDEX_NAME}" is ready.`);
  } catch (error: unknown) {
    if (error instanceof Error && error.message?.includes('ALREADY_EXISTS')) {
      console.log(`Index "${INDEX_NAME}" already exists.`);
    } else {
      throw error;
    }
  }

  // Target either a specific namespace or the default namespace
  const index = pc.index(INDEX_NAME);
  const target = namespace ? index.namespace(namespace) : index;

  if (namespace) {
    console.log(`Target namespace: "${namespace}"`);
  }

  // 2. Read all PDF and Markdown files
  const resolvedDir = path.resolve(docsDir);
  console.log(`Scanning directory: ${resolvedDir}`);

  const entries = await fs.readdir(resolvedDir, { withFileTypes: true });
  const supportedFiles = entries.filter(
    (entry) =>
      entry.isFile() &&
      (entry.name.endsWith('.pdf') ||
        entry.name.endsWith('.md') ||
        entry.name.endsWith('.txt')),
  );

  if (supportedFiles.length === 0) {
    console.error(
      'No PDF, Markdown, or text files found in the specified directory.',
    );
    process.exit(1);
  }

  console.log(`Found ${supportedFiles.length} file(s) to process.\n`);

  let totalChunks = 0;

  for (const file of supportedFiles) {
    const filePath = path.join(resolvedDir, file.name);
    const docTitle = fileNameToTitle(file.name);
    console.log(`Processing: ${file.name} (title: "${docTitle}")`);

    // 3. Extract text content (per-page for PDFs)
    let pages: string[];

    if (file.name.endsWith('.pdf')) {
      const buffer = await fs.readFile(filePath);
      pages = await extractPdfPages(buffer as unknown as Buffer);
    } else {
      const text = await fs.readFile(filePath, 'utf-8');
      pages = [text];
    }

    const fullText = pages.join('\n\n');

    if (!fullText.trim()) {
      console.log(`  Skipping "${file.name}" - no text content found.`);
      continue;
    }

    // 4. Chunk the document
    const doc = MDocument.fromText(fullText);
    const chunks = await doc.chunk({
      strategy: 'recursive',
      maxSize: 512,
      overlap: 50,
    });

    console.log(`  Created ${chunks.length} chunks`);

    // 5. Determine category from filename
    const category = inferCategory(file.name);

    // 6. Build records with hierarchical context prefix
    const records = chunks.map((chunk, idx) => {
      const section = extractNearestHeading(chunk.text);
      const pageNumber = findPageForChunk(chunk.text, pages);

      // Prepend source context to the chunk text for better retrieval
      const contextPrefix = section
        ? `[Source: ${docTitle} | Section: ${section}]`
        : `[Source: ${docTitle}]`;
      const enrichedText = `${contextPrefix}\n${chunk.text}`;

      return {
        _id: sanitizeId(`${file.name}-chunk-${idx}`),
        text: enrichedText,
        source: file.name,
        sourceTitle: docTitle,
        section: section || '',
        category,
        ...(pageNumber !== undefined ? { page: pageNumber } : {}),
      };
    });

    // 7. Upsert records in batches (Pinecone auto-embeds with llama-text-embed-v2)
    try {
      for (let i = 0; i < records.length; i += BATCH_SIZE) {
        const batch = records.slice(i, i + BATCH_SIZE);

        await target.upsertRecords({ records: batch });

        console.log(
          `  Upserted batch ${Math.floor(i / BATCH_SIZE) + 1} (${batch.length} records)`,
        );
      }

      totalChunks += records.length;
    } catch (err) {
      console.error(`  Failed to upsert "${file.name}":`, (err as Error).message);
    }
    console.log('');
  }

  const namespaceInfo = namespace ? ` into namespace "${namespace}"` : '';
  console.log(
    `\nDone. Ingested ${totalChunks} total chunks from ${supportedFiles.length} file(s)${namespaceInfo} in "${INDEX_NAME}".`,
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Sanitize a string to be a valid Pinecone vector ID (ASCII-only).
 */
function sanitizeId(id: string): string {
  return id.replace(/[^\x20-\x7E]/g, '').replace(/\s+/g, '_');
}

/**
 * Infer a category from the filename for metadata filtering.
 */
function inferCategory(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.includes('motor') || lower.includes('vehicle'))
    return 'motor-vehicle';
  if (lower.includes('trn')) return 'trn';
  if (lower.includes('tax') || lower.includes('filing')) return 'tax';
  if (lower.includes('faq')) return 'faq';
  return 'general';
}

/**
 * Try to determine which PDF page a chunk came from by checking
 * which page's text contains the start of the chunk.
 */
function findPageForChunk(chunkText: string, pages: string[]): number | undefined {
  if (pages.length <= 1) return pages.length === 1 ? 1 : undefined;

  const snippet = chunkText.slice(0, 80).trim();
  for (let i = 0; i < pages.length; i++) {
    if (pages[i].includes(snippet)) {
      return i + 1; // 1-based page number
    }
  }
  return undefined;
}

main().catch((error) => {
  console.error('Ingestion failed:', error);
  process.exit(1);
});
