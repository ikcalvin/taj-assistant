import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Pinecone } from '@pinecone-database/pinecone';

const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY! });
const index = pc.index('taj-knowledge');

/**
 * Factory that creates a RAG tool locked to a specific Pinecone namespace.
 * Each specialist agent gets its own instance so retrieval stays in-domain.
 */
export function createRagTool(namespace: string) {
  const ns = index.namespace(namespace);

  return createTool({
    id: `taj-knowledge-search-${namespace}`,
    description: `Search the TAJ knowledge base (${namespace} domain) for relevant information. Always use this tool before answering user questions.`,
    inputSchema: z.object({
      query: z
        .string()
        .describe('The search query to find relevant TAJ information'),
    }),
    outputSchema: z.object({
      results: z.array(
        z.object({
          text: z.string(),
          score: z.number(),
          source: z.string().optional(),
          section: z.string().optional(),
        }),
      ),
      topScore: z.number().describe('The highest match score among all results. If below 0.75, consider using web search as a fallback.'),
    }),
    execute: async (inputData) => {
      try {
        const response = await ns.searchRecords({
          query: {
            inputs: { text: inputData.query },
            topK: 5,
          },
          fields: ['text', 'source', 'section', 'category'],
        });

        const results = (response.result?.hits || []).map((hit) => ({
          text: (hit.fields as Record<string, unknown>)?.text as string || '',
          score: hit._score || 0,
          source:
            ((hit.fields as Record<string, unknown>)?.source as string) ||
            'TAJ Knowledge Base',
          section:
            ((hit.fields as Record<string, unknown>)?.section as string) ||
            undefined,
        }));

        const topScore = results.length > 0
          ? Math.max(...results.map((r) => r.score))
          : 0;

        return { results, topScore };
      } catch (error) {
        console.error(`Error searching TAJ knowledge base (${namespace}):`, error);
        return { results: [], topScore: 0 };
      }
    },
  });
}

/**
 * Default RAG tool querying all namespaces (general fallback).
 * Kept for backward compatibility with the existing taj-agent.
 */
export const tajKnowledgeTool = createTool({
  id: 'taj-knowledge-search',
  description:
    'Search the TAJ knowledge base for relevant information about tax services, TRN registration, motor vehicle services, filing deadlines, penalties, and other TAJ-related topics. Always use this tool before answering user questions.',
  inputSchema: z.object({
    query: z
      .string()
      .describe('The search query to find relevant TAJ information'),
  }),
  outputSchema: z.object({
    results: z.array(
      z.object({
        text: z.string(),
        score: z.number(),
        source: z.string().optional(),
      }),
    ),
    topScore: z.number(),
  }),
  execute: async (inputData) => {
    try {
      const response = await index.searchRecords({
        query: {
          inputs: { text: inputData.query },
          topK: 5,
        },
        fields: ['text', 'source', 'category'],
      });

      const results = (response.result?.hits || []).map((hit) => ({
        text: (hit.fields as Record<string, unknown>)?.text as string || '',
        score: hit._score || 0,
        source:
          ((hit.fields as Record<string, unknown>)?.source as string) ||
          'TAJ Knowledge Base',
      }));

      const topScore = results.length > 0
        ? Math.max(...results.map((r) => r.score))
        : 0;

      return { results, topScore };
    } catch (error) {
      console.error('Error searching TAJ knowledge base:', error);
      return { results: [], topScore: 0 };
    }
  },
});
