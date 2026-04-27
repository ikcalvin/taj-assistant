/**
 * TAJ Knowledge Base Ingestion Script
 *
 * Reads PDF and Markdown files from a directory, chunks them,
 * and upserts them into Pinecone using integrated inference
 * (llama-text-embed-v2 handles embedding on Pinecone's side).
 *
 * Usage:
 *   npx tsx --env-file=.env src/scripts/ingest.ts ./path/to/documents/
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

function isTextItem(item: TextItem | TextMarkedContent): item is TextItem {
  return 'str' in item && typeof item.str === 'string';
}

/**
 * Extract all text from a PDF buffer using pdfjs-dist.
 */
async function extractPdfText(buffer: Buffer): Promise<string> {
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

  return pages.join('\n\n');
}

async function main() {
  const docsDir = process.argv[2];

  if (!docsDir) {
    console.error(
      'Usage: npx tsx --env-file=.env src/scripts/ingest.ts ./path/to/documents/',
    );
    process.exit(1);
  }

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

  const index = pc.index(INDEX_NAME);

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
    console.log(`Processing: ${file.name}`);

    // 3. Extract text content
    let textContent: string;

    if (file.name.endsWith('.pdf')) {
      const buffer = await fs.readFile(filePath);
      textContent = await extractPdfText(buffer as unknown as Buffer);
    } else {
      textContent = await fs.readFile(filePath, 'utf-8');
    }

    if (!textContent.trim()) {
      console.log(`  Skipping "${file.name}" - no text content found.`);
      continue;
    }

    // 4. Chunk the document
    const doc = MDocument.fromText(textContent);
    const chunks = await doc.chunk({
      strategy: 'recursive',
      maxSize: 512,
      overlap: 50,
    });

    console.log(`  Created ${chunks.length} chunks`);

    // 5. Determine category from filename
    const category = inferCategory(file.name);

    // 6. Upsert records in batches (Pinecone auto-embeds with llama-text-embed-v2)
    try {
      for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
        const batch = chunks.slice(i, i + BATCH_SIZE);

        const records = batch.map((chunk, batchIndex) => ({
          _id: sanitizeId(`${file.name}-chunk-${i + batchIndex}`),
          text: chunk.text,
          source: file.name,
          category,
        }));

        await index.upsertRecords({ records });

        console.log(
          `  Upserted batch ${Math.floor(i / BATCH_SIZE) + 1} (${batch.length} records)`,
        );
      }

      totalChunks += chunks.length;
    } catch (err) {
      console.error(`  Failed to upsert "${file.name}":`, (err as Error).message);
    }
    console.log('');
  }

  console.log(
    `\nDone. Ingested ${totalChunks} total chunks from ${supportedFiles.length} file(s) into "${INDEX_NAME}".`,
  );
}

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

main().catch((error) => {
  console.error('Ingestion failed:', error);
  process.exit(1);
});
