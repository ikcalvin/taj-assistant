import { createTool } from '@mastra/core/tools';
import { count } from 'node:console';
import { z } from 'zod';

/**
 * Web search fallback tool using Tavily API.
 * Uses online search for information when the knowledge base returns low-confidence results.
 * Used when Pinecone RAG scores fall below the 0.75 threshold.
 */
export const webSearchTool = createTool({
  id: 'taj-web-search',
  description:
    'Search online for information using Tavily API. Use this when the knowledge base search returns low-confidence results (topScore below 0.75).',
  inputSchema: z.object({
    query: z
      .string()
      .describe('The search query about TAJ services'),
  }),
  outputSchema: z.object({
    results: z.array(
      z.object({
        title: z.string(),
        url: z.string(),
        content: z.string(),
      }),
    ),
  }),
  execute: async (inputData) => {
    const apiKey = process.env.SEARCH_API_KEY;

    if (!apiKey) {
      console.error('SEARCH_API_KEY is not set. Web search fallback is disabled.');
      return { results: [] };
    }

    try {
      const response = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          api_key: apiKey,
          query: inputData.query,
          search_depth: 'advanced',
          max_results: 3,
          include_answer: 'advanced',
          include_raw_content: false,
          country: 'jamaica',
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`Tavily search failed: ${response.status} ${errorText}`);
        return { results: [] };
      }

      const data = (await response.json()) as {
        results?: Array<{
          title?: string;
          url?: string;
          content?: string;
        }>;
      };

      const results = (data.results || []).map((r) => ({
        title: r.title || '',
        url: r.url || '',
        content: r.content || '',
      }));

      return { results };
    } catch (error) {
      console.error('Web search fallback failed:', error);
      return { results: [] };
    }
  },
});
