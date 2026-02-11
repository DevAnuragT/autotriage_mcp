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
  searchOpenIssues,
  type GitHubIssue,
} from './github.js';
import {
  classifyIssue,
  mapToKebabLabels,
  generateTriageComment,
} from './classifier.js';

// Validation schema for triage_issue tool
const TriageIssueArgsSchema = z.object({
  mode: z
    .enum(['maintainer', 'contributor'])
    .describe('Triage mode: maintainer (full triage with labels/comments) or contributor (search and recommend issues)'),
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
    .optional()
    .describe('GitHub issue number (required for maintainer mode)'),
  labels: z
    .array(z.string())
    .optional()
    .describe('Filter issues by labels (contributor mode only, e.g., ["good first issue", "help wanted"])'),
  limit: z
    .number()
    .int()
    .positive()
    .default(10)
    .describe('Maximum number of issues to return (contributor mode only, default: 10)'),
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
          'Dual-mode GitHub issue assistant. ' +
          'MAINTAINER MODE: Analyze and triage an issue with AI classification, apply labels, post summary (requires repo write access). ' +
          'CONTRIBUTOR MODE: Search open issues by label/complexity, rank by beginner-friendliness, return recommendations.',
        inputSchema: {
          type: 'object',
          properties: {
            mode: {
              type: 'string',
              enum: ['maintainer', 'contributor'],
              description: 'Triage mode: "maintainer" for full triage or "contributor" for issue recommendations',
            },
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
              description: 'GitHub issue number (required for maintainer mode)',
            },
            labels: {
              type: 'array',
              items: { type: 'string' },
              description: 'Filter issues by labels (contributor mode, e.g., ["good first issue"])',
            },
            limit: {
              type: 'number',
              description: 'Max issues to return (contributor mode, default: 10)',
            },
          },
          required: ['mode', 'owner', 'repo'],
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
      const { mode, owner, repo, issue_number, labels, limit } = validatedArgs;

      console.error(`[INFO] Mode: ${mode}`);

      // MAINTAINER MODE: Full triage with classification, labels, and comment
      if (mode === 'maintainer') {
        if (!issue_number) {
          return {
            content: [
              {
                type: 'text',
                text: 'Error: issue_number is required for maintainer mode',
              },
            ],
            isError: true,
          };
        }

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
                  text: `Error: Authentication failed or insufficient permissions. Please check your GITHUB_TOKEN has 'repo' scope.`,
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
      }

      // CONTRIBUTOR MODE: Search and recommend issues
      if (mode === 'contributor') {
        console.error(
          `[INFO] Searching for contributor-friendly issues in ${owner}/${repo}` +
          (labels?.length ? ` with labels: ${labels.join(', ')}` : '')
        );

        let issues: GitHubIssue[];
        try {
          issues = await searchOpenIssues(owner, repo, labels, limit);
        } catch (error: any) {
          console.error(`[ERROR] Failed to search issues: ${error.message}`);
          
          if (error.status === 404) {
            return {
              content: [
                {
                  type: 'text',
                  text: `Error: Repository ${owner}/${repo} not found. Please verify the repository name.`,
                },
              ],
              isError: true,
            };
          } else if (error.status === 401 || error.status === 403) {
            return {
              content: [
                {
                  type: 'text',
                  text: `Error: Authentication failed. Please check your GITHUB_TOKEN.`,
                },
              ],
              isError: true,
            };
          }
          
          throw error;
        }

        // Filter out assigned issues
        const unassignedIssues = issues.filter(issue => !issue.assignee);

        if (unassignedIssues.length === 0) {
          return {
            content: [
              {
                type: 'text',
                text: `No unassigned open issues found in ${owner}/${repo}` +
                  (labels?.length ? ` with labels: ${labels.join(', ')}` : '') +
                  '. Try different label filters or check back later.',
              },
            ],
          };
        }

        // Helper: Calculate beginner-friendliness score (higher = better for beginners)
        const calculateScore = (issue: GitHubIssue): number => {
          let score = 100;
          
          // Fewer comments = less active discussion = potentially simpler
          const commentCount = issue.comments || 0;
          score -= Math.min(commentCount * 5, 30); // Cap penalty at 30
          
          // Bonus for beginner-friendly labels
          const labelNames = issue.labels.map(l => l.toLowerCase());
          if (labelNames.some(l => l.includes('good first issue') || l.includes('good-first-issue'))) {
            score += 50;
          }
          if (labelNames.some(l => l.includes('help wanted') || l.includes('help-wanted'))) {
            score += 30;
          }
          if (labelNames.some(l => l.includes('easy') || l.includes('beginner'))) {
            score += 40;
          }
          if (labelNames.some(l => l.includes('documentation') || l.includes('docs'))) {
            score += 20;
          }
          
          return score;
        };

        // Helper: Estimate complexity from labels
        const estimateComplexity = (issue: GitHubIssue): string => {
          const labelNames = issue.labels.map(l => l.toLowerCase());
          
          if (labelNames.some(l => l.includes('complexity-low') || l.includes('easy') || l.includes('simple'))) {
            return 'Low';
          }
          if (labelNames.some(l => l.includes('complexity-high') || l.includes('hard') || l.includes('complex'))) {
            return 'High';
          }
          if (labelNames.some(l => l.includes('complexity-medium') || l.includes('moderate'))) {
            return 'Medium';
          }
          
          // Default: guess based on comment count
          const commentCount = issue.comments || 0;
          if (commentCount < 3) return 'Low';
          if (commentCount > 10) return 'High';
          return 'Medium';
        };

        // Helper: Suggest skill fit based on labels
        const suggestSkillFit = (issue: GitHubIssue): string => {
          const labelNames = issue.labels.map(l => l.toLowerCase());
          const fits: string[] = [];
          
          if (labelNames.some(l => l.includes('frontend') || l.includes('ui') || l.includes('css'))) {
            fits.push('Frontend');
          }
          if (labelNames.some(l => l.includes('backend') || l.includes('api') || l.includes('server'))) {
            fits.push('Backend');
          }
          if (labelNames.some(l => l.includes('documentation') || l.includes('docs'))) {
            fits.push('Documentation');
          }
          if (labelNames.some(l => l.includes('testing') || l.includes('test'))) {
            fits.push('Testing');
          }
          
          return fits.length > 0 ? fits.join(', ') : 'General';
        };

        // Rank issues by beginner-friendliness
        const rankedIssues = unassignedIssues
          .map(issue => ({
            issue,
            score: calculateScore(issue),
            complexity: estimateComplexity(issue),
            skillFit: suggestSkillFit(issue),
          }))
          .sort((a, b) => b.score - a.score); // Higher score first

        // Format response
        const recommendations = rankedIssues.map((item, index) => {
          const { issue, complexity, skillFit } = item;
          return (
            `${index + 1}. **#${issue.number}**: ${issue.title}\n` +
            `   - **Complexity**: ${complexity}\n` +
            `   - **Skill Fit**: ${skillFit}\n` +
            `   - **Comments**: ${issue.comments || 0}\n` +
            `   - **Labels**: ${issue.labels.join(', ') || 'none'}\n` +
            `   - **URL**: https://github.com/${owner}/${repo}/issues/${issue.number}`
          );
        }).join('\n\n');

        const resultMessage = 
          `Found ${rankedIssues.length} recommended issue(s) in ${owner}/${repo}` +
          (labels?.length ? ` (filtered by: ${labels.join(', ')})` : '') +
          ':\n\n' + recommendations;

        console.error(`[INFO] Returned ${rankedIssues.length} recommendations`);

        return {
          content: [
            {
              type: 'text',
              text: resultMessage,
            },
          ],
        };
      }

      // Invalid mode (shouldn't happen with zod validation)
      return {
        content: [
          {
            type: 'text',
            text: `Error: Invalid mode '${mode}'. Must be 'maintainer' or 'contributor'.`,
          },
        ],
        isError: true,
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
