import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Pinecone } from '@pinecone-database/pinecone';

const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY! });
const index = pc.index('taj-knowledge');

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

      return { results };
    } catch (error) {
      console.error('Error searching TAJ knowledge base:', error);
      return { results: [] };
    }
  },
});
