import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

/**
 * Web search fallback tool using Tavily API.
 * Scoped to jamaicatax.gov.jm so results stay authoritative.
 * Used when Pinecone RAG scores fall below the 0.75 threshold.
 */
export const webSearchTool = createTool({
  id: 'taj-web-search',
  description:
    'Search the official TAJ website (jamaicatax.gov.jm) for information. Use this ONLY when the knowledge base search returns low-confidence results (topScore below 0.75).',
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
          search_depth: 'basic',
          include_domains: ['jamaicatax.gov.jm'],
          max_results: 3,
          include_answer: false,
          include_raw_content: false,
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
