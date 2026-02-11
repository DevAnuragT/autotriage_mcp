#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import {
  fetchIssue,
  checkExistingTriageComment,
  removeTriageLabels,
  applyLabels,
  postComment,
} from './github.js';
import {
  classifyIssue,
  mapToKebabLabels,
  generateTriageComment,
} from './classifier.js';

// Validation schema for triage_issue tool
const TriageIssueArgsSchema = z.object({
  owner: z
    .string()
    .min(1)
    .describe('GitHub repository owner/organization name'),
  repo: z
    .string()
    .min(1)
    .describe('GitHub repository name'),
  issue_number: z
    .number()
    .int()
    .positive()
    .describe('GitHub issue number'),
});

/**
 * Initialize MCP Server
 */
const server = new Server(
  {
    name: 'github-triage-mcp',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

/**
 * List available tools
 */
server.setRequestHandler(ListToolsRequestSchema, async () => {
  console.error('[INFO] Listing available tools');
  
  return {
    tools: [
      {
        name: 'triage_issue',
        description: 
          'Analyze a GitHub issue and perform intelligent triage. ' +
          'Classifies by type (bug/feature/enhancement/question), ' +
          'priority (P0-P3), and complexity (Low/Medium/High). ' +
          'Applies kebab-case labels and posts a structured triage summary comment. ' +
          'Idempotent: re-running updates labels without duplicating comments.',
        inputSchema: {
          type: 'object',
          properties: {
            owner: {
              type: 'string',
              description: 'GitHub repository owner/organization name',
            },
            repo: {
              type: 'string',
              description: 'GitHub repository name',
            },
            issue_number: {
              type: 'number',
              description: 'GitHub issue number',
            },
          },
          required: ['owner', 'repo', 'issue_number'],
        },
      },
    ],
  };
});

/**
 * Handle tool execution
 */
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  console.error(`[INFO] Tool called: ${name}`);

  if (name === 'triage_issue') {
    try {
      // Validate arguments
      const validatedArgs = TriageIssueArgsSchema.parse(args);
      const { owner, repo, issue_number } = validatedArgs;

      console.error(
        `[INFO] Starting triage for ${owner}/${repo}#${issue_number}`
      );

      // Step 1: Fetch issue details
      let issue;
      try {
        issue = await fetchIssue(owner, repo, issue_number);
      } catch (error: any) {
        console.error(`[ERROR] Failed to fetch issue: ${error.message}`);
        
        // Controlled failure: issue not found or access denied
        if (error.status === 404) {
          return {
            content: [
              {
                type: 'text',
                text: `Error: Issue #${issue_number} not found in ${owner}/${repo}. Please verify the repository and issue number.`,
              },
            ],
            isError: true,
          };
        } else if (error.status === 401 || error.status === 403) {
          return {
            content: [
              {
                type: 'text',
                text: `Error: Authentication failed or insufficient permissions. Please check your GITHUB_TOKEN.`,
              },
            ],
            isError: true,
          };
        }
        
        // Unexpected failure
        throw error;
      }

      // Step 2: Check for existing triage comment
      const hasExistingComment = await checkExistingTriageComment(
        owner,
        repo,
        issue_number
      );

      // Step 3: Classify the issue using Gemini
      let classification;
      try {
        classification = await classifyIssue(issue.title, issue.body);
      } catch (error: any) {
        console.error(`[ERROR] Classification failed: ${error.message}`);
        
        // Controlled failure: API key missing or invalid
        if (error.message?.includes('GOOGLE_API_KEY')) {
          return {
            content: [
              {
                type: 'text',
                text: `Error: GOOGLE_API_KEY environment variable is not set. Please configure your Gemini API key.`,
              },
            ],
            isError: true,
          };
        }
        
        // Unexpected failure
        throw error;
      }

      console.error(
        `[INFO] Classification: type=${classification.type}, priority=${classification.priority}, complexity=${classification.complexity}`
      );

      // Step 4: Remove existing triage labels
      await removeTriageLabels(owner, repo, issue_number, issue.labels);

      // Step 5: Generate and apply new labels
      const newLabels = mapToKebabLabels(classification);
      await applyLabels(owner, repo, issue_number, newLabels);

      // Step 6: Post triage comment (only if it doesn't exist)
      if (!hasExistingComment) {
        const comment = generateTriageComment(classification);
        await postComment(owner, repo, issue_number, comment);
        console.error(`[INFO] Triage comment posted`);
      } else {
        console.error(
          `[INFO] Triage comment already exists, skipping duplicate post`
        );
      }

      // Success response
      const resultMessage = hasExistingComment
        ? `Successfully updated triage labels for issue #${issue_number}. ` +
          `Classified as: ${classification.type} (${classification.priority}, ${classification.complexity}). ` +
          `Existing triage comment was preserved (no duplicate posted).`
        : `Successfully triaged issue #${issue_number}. ` +
          `Classified as: ${classification.type} (${classification.priority}, ${classification.complexity}). ` +
          `Labels applied: ${newLabels.join(', ')}. Triage comment posted.`;

      console.error(`[INFO] Triage completed successfully`);

      return {
        content: [
          {
            type: 'text',
            text: resultMessage,
          },
        ],
      };
    } catch (error: any) {
      // Unexpected failures
      console.error(`[ERROR] Unexpected error during triage: ${error.message}`);
      console.error(error.stack);
      
      return {
        content: [
          {
            type: 'text',
            text: `Unexpected error during triage: ${error.message}. Please check the server logs for details.`,
          },
        ],
        isError: true,
      };
    }
  }

  // Unknown tool
  return {
    content: [
      {
        type: 'text',
        text: `Unknown tool: ${name}`,
      },
    ],
    isError: true,
  };
});

/**
 * Start the server
 */
async function main() {
  console.error('[INFO] Starting GitHub Triage MCP Server');
  console.error(`[INFO] Server version: 1.0.0`);
  
  // Verify required environment variables
  if (!process.env.GITHUB_TOKEN) {
    console.error('[WARN] GITHUB_TOKEN environment variable is not set');
  }
  if (!process.env.GOOGLE_API_KEY) {
    console.error('[WARN] GOOGLE_API_KEY environment variable is not set');
  }
  
  const transport = new StdioServerTransport();
  await server.connect(transport);
  
  console.error('[INFO] Server connected via stdio transport');
  console.error('[INFO] Ready to accept triage requests');
}

main().catch((error) => {
  console.error('[FATAL] Server startup failed:', error);
  process.exit(1);
});
