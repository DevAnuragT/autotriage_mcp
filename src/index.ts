#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import http from 'http';
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
    .optional()
    .default(10)
    .describe('Maximum number of issues to return (contributor mode only, default: 10)'),
});

const BatchTriageArgsSchema = z.object({
  owner: z
    .string()
    .min(1)
    .describe('GitHub repository owner/organization name'),
  repo: z
    .string()
    .min(1)
    .describe('GitHub repository name'),
  dry_run: z
    .boolean()
    .optional()
    .default(false)
    .describe('If true, classify issues but do not apply labels or post comments'),
});

const TriageStatsArgsSchema = z.object({
  owner: z
    .string()
    .min(1)
    .describe('GitHub repository owner/organization name'),
  repo: z
    .string()
    .min(1)
    .describe('GitHub repository name'),
});

/**
 * Initialize MCP Server
 */
const server = new Server(
  {
    name: 'github-triage-mcp',
    version: '1.1.0',
  },
  {
    capabilities: {
      tools: {},
      resources: {},
      prompts: {},
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
      {
        name: 'batch_triage',
        description:
          'Batch triage all open issues in a repository. Analyzes and classifies all open issues using AI, ' +
          'applies labels in batch, and returns summary statistics. Rate-limited for GitHub API and Gemini API.',
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
            dry_run: {
              type: 'boolean',
              description: 'If true, classify issues but do not apply labels or post comments (default: false)',
            },
          },
          required: ['owner', 'repo'],
        },
      },
      {
        name: 'triage_stats',
        description:
          'Get triage statistics for a repository. Analyzes issue labels to provide metrics on open issues by type, ' +
          'priority distribution, average issue age, and stale issue count (>30 days inactive).',
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
          },
          required: ['owner', 'repo'],
        },
      },
    ],
  };
});

/**
 * List available resources
 */
server.setRequestHandler(ListResourcesRequestSchema, async () => {
  console.error('[INFO] Listing available resources');
  
  return {
    resources: [
      {
        uri: 'triage://stats/{owner}/{repo}',
        name: 'Repository Triage Statistics',
        description: 'Real-time triage statistics for a GitHub repository including issue counts by type, priority, complexity, and staleness metrics',
        mimeType: 'application/json',
      },
    ],
  };
});

/**
 * Handle resource reads
 */
server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const { uri } = request.params;
  
  console.error(`[INFO] Resource requested: ${uri}`);
  
  // Parse triage://stats/{owner}/{repo} URIs
  const match = uri.match(/^triage:\/\/stats\/([^\/]+)\/([^\/]+)$/);
  if (!match) {
    throw new Error(`Unknown resource URI: ${uri}`);
  }
  
  const [, owner, repo] = match;
  
  try {
    // Fetch all open issues
    const issues = await searchOpenIssues(owner, repo);
    
    // Calculate statistics
    const stats = {
      total_open_issues: issues.length,
      by_type: {
        bug: issues.filter(i => i.labels.some(l => l.toLowerCase().includes('bug'))).length,
        feature: issues.filter(i => i.labels.some(l => l.toLowerCase().includes('feature') || l.toLowerCase().includes('enhancement'))).length,
        documentation: issues.filter(i => i.labels.some(l => l.toLowerCase().includes('documentation') || l.toLowerCase().includes('docs'))).length,
        question: issues.filter(i => i.labels.some(l => l.toLowerCase().includes('question'))).length,
        other: 0,
      },
      by_priority: {
        p0_critical: issues.filter(i => i.labels.some(l => l.toLowerCase() === 'priority-p0' || l.toLowerCase() === 'critical')).length,
        p1_high: issues.filter(i => i.labels.some(l => l.toLowerCase() === 'priority-p1' || l.toLowerCase() === 'high')).length,
        p2_medium: issues.filter(i => i.labels.some(l => l.toLowerCase() === 'priority-p2' || l.toLowerCase() === 'medium')).length,
        p3_low: issues.filter(i => i.labels.some(l => l.toLowerCase() === 'priority-p3' || l.toLowerCase() === 'low')).length,
      },
      by_complexity: {
        low: issues.filter(i => i.labels.some(l => l.toLowerCase().includes('complexity-low') || l.toLowerCase().includes('easy'))).length,
        medium: issues.filter(i => i.labels.some(l => l.toLowerCase().includes('complexity-medium'))).length,
        high: issues.filter(i => i.labels.some(l => l.toLowerCase().includes('complexity-high') || l.toLowerCase().includes('hard'))).length,
      },
      beginner_friendly: issues.filter(i => 
        i.labels.some(l => l.toLowerCase().includes('good first issue') || l.toLowerCase().includes('help wanted'))
      ).length,
      stale_issues: issues.filter(i => {
        const daysSinceUpdate = (Date.now() - new Date(i.updated_at).getTime()) / (1000 * 60 * 60 * 24);
        return daysSinceUpdate > 30;
      }).length,
      average_age_days: issues.length > 0 
        ? Math.round(issues.reduce((sum, i) => {
            const age = (Date.now() - new Date(i.created_at).getTime()) / (1000 * 60 * 60 * 24);
            return sum + age;
          }, 0) / issues.length)
        : 0,
    };
    
    // Calculate 'other' type
    stats.by_type.other = stats.total_open_issues - 
      (stats.by_type.bug + stats.by_type.feature + stats.by_type.documentation + stats.by_type.question);
    
    return {
      contents: [
        {
          uri,
          mimeType: 'application/json',
          text: JSON.stringify(stats, null, 2),
        },
      ],
    };
  } catch (error: any) {
    throw new Error(`Failed to fetch triage stats for ${owner}/${repo}: ${error.message}`);
  }
});

/**
 * List available prompts
 */
server.setRequestHandler(ListPromptsRequestSchema, async () => {
  console.error('[INFO] Listing available prompts');
  
  return {
    prompts: [
      {
        name: 'triage-issue',
        description: 'Triage a specific GitHub issue with AI classification',
        arguments: [
          {
            name: 'owner',
            description: 'Repository owner',
            required: true,
          },
          {
            name: 'repo',
            description: 'Repository name',
            required: true,
          },
          {
            name: 'issue_number',
            description: 'Issue number to triage',
            required: true,
          },
        ],
      },
      {
        name: 'find-beginner-issues',
        description: 'Find good first issues for new contributors',
        arguments: [
          {
            name: 'owner',
            description: 'Repository owner',
            required: true,
          },
          {
            name: 'repo',
            description: 'Repository name',
            required: true,
          },
        ],
      },
      {
        name: 'repo-health-check',
        description: 'Get comprehensive repository health metrics',
        arguments: [
          {
            name: 'owner',
            description: 'Repository owner',
            required: true,
          },
          {
            name: 'repo',
            description: 'Repository name',
            required: true,
          },
        ],
      },
    ],
  };
});

/**
 * Handle prompt execution
 */
server.setRequestHandler(GetPromptRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  
  console.error(`[INFO] Prompt requested: ${name}`);
  
  if (name === 'triage-issue') {
    const owner = args?.owner as string;
    const repo = args?.repo as string;
    const issue_number = args?.issue_number as string;
    
    if (!owner || !repo || !issue_number) {
      throw new Error('Missing required arguments: owner, repo, issue_number');
    }
    
    return {
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Please triage issue #${issue_number} in the ${owner}/${repo} repository. Use the triage_issue tool in maintainer mode to classify the issue and apply appropriate labels.`,
          },
        },
      ],
    };
  }
  
  if (name === 'find-beginner-issues') {
    const owner = args?.owner as string;
    const repo = args?.repo as string;
    
    if (!owner || !repo) {
      throw new Error('Missing required arguments: owner, repo');
    }
    
    return {
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Find beginner-friendly issues in ${owner}/${repo}. Use the triage_issue tool in contributor mode with labels like ["good first issue", "help wanted"] to get recommendations for new contributors.`,
          },
        },
      ],
    };
  }
  
  if (name === 'repo-health-check') {
    const owner = args?.owner as string;
    const repo = args?.repo as string;
    
    if (!owner || !repo) {
      throw new Error('Missing required arguments: owner, repo');
    }
    
    return {
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Analyze the health of ${owner}/${repo}. Use the triage_stats tool to get comprehensive statistics about open issues, their priorities, types, and staleness. Then provide insights and recommendations.`,
          },
        },
      ],
    };
  }
  
  throw new Error(`Unknown prompt: ${name}`);
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
        // Filter out empty strings from labels
        const filteredLabels = labels?.filter(l => l && l.trim().length > 0);
        
        console.error(
          `[INFO] Searching for contributor-friendly issues in ${owner}/${repo}` +
          (filteredLabels?.length ? ` with labels: ${filteredLabels.join(', ')}` : '') + ``
        );

        let issues: GitHubIssue[];
        try {
          issues = await searchOpenIssues(owner, repo, filteredLabels, limit);
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
                  (filteredLabels?.length ? ` with labels: ${filteredLabels.join(', ')}` : '') +
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
          const labels = issue.labels.length > 0 
            ? issue.labels.join(', ')
            : 'none';
          
          return (
            `${index + 1}. #${issue.number}: ${issue.title}\n` +
            `   Complexity: ${complexity} | Skill Fit: ${skillFit} | Comments: ${issue.comments || 0}\n` +
            `   Labels: ${labels}\n` +
            `   URL: https://github.com/${owner}/${repo}/issues/${issue.number}`
          );
        }).join('\n\n');

        const header = `🎯 Found ${rankedIssues.length} recommended issue${rankedIssues.length !== 1 ? 's' : ''} in ${owner}/${repo}` +
          (filteredLabels?.length ? ` (filtered by: ${filteredLabels.join(', ')})` : '') +
          '\n\n';

        const resultMessage = header + recommendations;

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
      console.error(`${error.stack}`);
      
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

  if (name === 'batch_triage') {
    try {
      const validatedArgs = BatchTriageArgsSchema.parse(args);
      const { owner, repo, dry_run } = validatedArgs;

      console.error(`[INFO] Batch triaging ${owner}/${repo} (dry_run: ${dry_run})`);

      // Fetch all open issues
      const issues = await searchOpenIssues(owner, repo, undefined, 100);
      if (issues.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: `No open issues found in ${owner}/${repo}.`,
            },
          ],
        };
      }

      console.error(`[INFO] Found ${issues.length} open issues to triage`);

      // Track statistics
      const stats = {
        total: issues.length,
        triaged: 0,
        skipped: 0,
        failed: 0,
        byType: { bug: 0, feature: 0, question: 0, documentation: 0, other: 0 },
        byPriority: { p0: 0, p1: 0, p2: 0, p3: 0 },
        byComplexity: { low: 0, medium: 0, high: 0 },
      };

      // Rate limiting: Gemini = 15 RPM, GitHub = 5000/hr
      const GEMINI_DELAY_MS = 4000; // ~15 requests per minute
      const results: string[] = [];

      for (let i = 0; i < issues.length; i++) {
        const issue = issues[i];
        console.error(`[INFO] Processing issue #${issue.number} (${i + 1}/${issues.length})`);

        try {
          // Check if already triaged
          const existingLabels = issue.labels.map((l: string) => l.toLowerCase());
          const hasTypeLabel = existingLabels.some((l: string) => 
            l.includes('type-') || l.includes('bug') || l.includes('feature')
          );
          const hasPriorityLabel = existingLabels.some((l: string) => l.includes('p0') || l.includes('p1') || l.includes('p2') || l.includes('p3'));
          const hasComplexityLabel = existingLabels.some((l: string) => l.includes('complexity-'));

          if (hasTypeLabel && hasPriorityLabel && hasComplexityLabel) {
            console.error(`[INFO] Issue #${issue.number} already triaged, skipping`);
            stats.skipped++;
            continue;
          }

          // Classify the issue
          const classification = await classifyIssue(issue.title, issue.body || '');

          // Update statistics
          stats.triaged++;
          const typeKey = classification.type.toLowerCase() as keyof typeof stats.byType;
          if (typeKey in stats.byType) {
            stats.byType[typeKey]++;
          } else {
            stats.byType.other++;
          }
          stats.byPriority[classification.priority.toLowerCase() as keyof typeof stats.byPriority]++;
          stats.byComplexity[classification.complexity.toLowerCase() as keyof typeof stats.byComplexity]++;

          // Apply labels if not dry run
          if (!dry_run) {
            const labels = [
              `type-${classification.type.toLowerCase()}`,
              classification.priority.toUpperCase(),
              `complexity-${classification.complexity.toLowerCase()}`,
            ];

            try {
              await applyLabels(owner, repo, issue.number, labels);
              results.push(
                `✅ #${issue.number}: ${classification.type} | ${classification.priority} | ${classification.complexity}`
              );
            } catch (labelError: any) {
              console.error(`[WARN] Failed to apply labels to #${issue.number}: ${labelError.message}`);
              stats.failed++;
              results.push(`❌ #${issue.number}: Classification successful but labeling failed`);
            }
          } else {
            results.push(
              `🔍 #${issue.number}: ${classification.type} | ${classification.priority} | ${classification.complexity} (dry run)`
            );
          }

          // Rate limit: sleep between requests
          if (i < issues.length - 1) {
            await new Promise(resolve => setTimeout(resolve, GEMINI_DELAY_MS));
          }
        } catch (error: any) {
          console.error(`[ERROR] Failed to triage issue #${issue.number}: ${error.message}`);
          stats.failed++;
          results.push(`❌ #${issue.number}: Failed - ${error.message}`);
        }
      }

      // Format response
      const summary = 
        `📊 Batch Triage Summary for ${owner}/${repo}\n` +
        `${'='.repeat(50)}\n\n` +
        `Total Issues: ${stats.total}\n` +
        `Triaged: ${stats.triaged}\n` +
        `Skipped (already triaged): ${stats.skipped}\n` +
        `Failed: ${stats.failed}\n\n` +
        `By Type:\n` +
        `  Bug: ${stats.byType.bug}\n` +
        `  Feature: ${stats.byType.feature}\n` +
        `  Question: ${stats.byType.question}\n` +
        `  Documentation: ${stats.byType.documentation}\n` +
        `  Other: ${stats.byType.other}\n\n` +
        `By Priority:\n` +
        `  P0 (Critical): ${stats.byPriority.p0}\n` +
        `  P1 (High): ${stats.byPriority.p1}\n` +
        `  P2 (Medium): ${stats.byPriority.p2}\n` +
        `  P3 (Low): ${stats.byPriority.p3}\n\n` +
        `By Complexity:\n` +
        `  Low: ${stats.byComplexity.low}\n` +
        `  Medium: ${stats.byComplexity.medium}\n` +
        `  High: ${stats.byComplexity.high}\n\n` +
        `${dry_run ? '(DRY RUN - No labels applied)\n\n' : ''}` +
        `Individual Results:\n` +
        `${results.join('\n')}`;

      console.error(`[INFO] Batch triage complete: ${stats.triaged} triaged, ${stats.skipped} skipped, ${stats.failed} failed`);

      return {
        content: [
          {
            type: 'text',
            text: summary,
          },
        ],
      };
    } catch (error: any) {
      console.error(`[ERROR] Batch triage failed: ${error.message}`);
      console.error(error.stack);

      return {
        content: [
          {
            type: 'text',
            text: `Batch triage failed: ${error.message}. Please check the server logs for details.`,
          },
        ],
        isError: true,
      };
    }
  }

  if (name === 'triage_stats') {
    try {
      const validatedArgs = TriageStatsArgsSchema.parse(args);
      const { owner, repo } = validatedArgs;

      console.error(`[INFO] Fetching triage stats for ${owner}/${repo}`);

      // Fetch all open issues
      const issues = await searchOpenIssues(owner, repo, undefined, 100);
      if (issues.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: `No open issues found in ${owner}/${repo}.`,
            },
          ],
        };
      }

      // Calculate statistics
      const stats = {
        totalOpen: issues.length,
        byType: { bug: 0, feature: 0, question: 0, documentation: 0, other: 0, unlabeled: 0 },
        byPriority: { p0: 0, p1: 0, p2: 0, p3: 0, unlabeled: 0 },
        byComplexity: { low: 0, medium: 0, high: 0, unlabeled: 0 },
        avgAge: 0,
        staleCount: 0,
      };

      const now = Date.now();
      const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
      let totalAge = 0;

      for (const issue of issues) {
        const labels = issue.labels.map((l: string) => l.toLowerCase());

        // Type classification
        if (labels.some((l: string) => l.includes('bug') || l === 'type-bug')) {
          stats.byType.bug++;
        } else if (labels.some((l: string) => l.includes('feature') || l.includes('enhancement') || l === 'type-feature')) {
          stats.byType.feature++;
        } else if (labels.some((l: string) => l.includes('question') || l === 'type-question')) {
          stats.byType.question++;
        } else if (labels.some((l: string) => l.includes('documentation') || l.includes('docs') || l === 'type-documentation')) {
          stats.byType.documentation++;
        } else if (labels.some((l: string) => l.startsWith('type-') && !l.includes('bug') && !l.includes('feature'))) {
          stats.byType.other++;
        } else {
          stats.byType.unlabeled++;
        }

        // Priority classification
        if (labels.some((l: string) => l === 'p0' || l.includes('critical'))) {
          stats.byPriority.p0++;
        } else if (labels.some((l: string) => l === 'p1' || l.includes('high'))) {
          stats.byPriority.p1++;
        } else if (labels.some((l: string) => l === 'p2' || l.includes('medium'))) {
          stats.byPriority.p2++;
        } else if (labels.some((l: string) => l === 'p3' || l.includes('low'))) {
          stats.byPriority.p3++;
        } else {
          stats.byPriority.unlabeled++;
        }

        // Complexity classification
        if (labels.some((l: string) => l.includes('complexity-low') || l.includes('easy'))) {
          stats.byComplexity.low++;
        } else if (labels.some((l: string) => l.includes('complexity-medium'))) {
          stats.byComplexity.medium++;
        } else if (labels.some((l: string) => l.includes('complexity-high') || l.includes('hard'))) {
          stats.byComplexity.high++;
        } else {
          stats.byComplexity.unlabeled++;
        }

        // Age calculation
        const createdAt = new Date(issue.created_at).getTime();
        const age = now - createdAt;
        totalAge += age;

        // Stale detection (>30 days since last update)
        const updatedAt = new Date(issue.updated_at).getTime();
        if (now - updatedAt > THIRTY_DAYS_MS) {
          stats.staleCount++;
        }
      }

      stats.avgAge = Math.round(totalAge / issues.length / (24 * 60 * 60 * 1000)); // Convert to days

      // Format response
      const summary =
        `📊 Triage Statistics for ${owner}/${repo}\n` +
        `${'='.repeat(50)}\n\n` +
        `Total Open Issues: ${stats.totalOpen}\n` +
        `Average Issue Age: ${stats.avgAge} days\n` +
        `Stale Issues (>30 days inactive): ${stats.staleCount} (${Math.round(stats.staleCount / stats.totalOpen * 100)}%)\n\n` +
        `By Type:\n` +
        `  Bug: ${stats.byType.bug} (${Math.round(stats.byType.bug / stats.totalOpen * 100)}%)\n` +
        `  Feature: ${stats.byType.feature} (${Math.round(stats.byType.feature / stats.totalOpen * 100)}%)\n` +
        `  Question: ${stats.byType.question} (${Math.round(stats.byType.question / stats.totalOpen * 100)}%)\n` +
        `  Documentation: ${stats.byType.documentation} (${Math.round(stats.byType.documentation / stats.totalOpen * 100)}%)\n` +
        `  Other: ${stats.byType.other} (${Math.round(stats.byType.other / stats.totalOpen * 100)}%)\n` +
        `  Unlabeled: ${stats.byType.unlabeled} (${Math.round(stats.byType.unlabeled / stats.totalOpen * 100)}%)\n\n` +
        `By Priority:\n` +
        `  P0 (Critical): ${stats.byPriority.p0} (${Math.round(stats.byPriority.p0 / stats.totalOpen * 100)}%)\n` +
        `  P1 (High): ${stats.byPriority.p1} (${Math.round(stats.byPriority.p1 / stats.totalOpen * 100)}%)\n` +
        `  P2 (Medium): ${stats.byPriority.p2} (${Math.round(stats.byPriority.p2 / stats.totalOpen * 100)}%)\n` +
        `  P3 (Low): ${stats.byPriority.p3} (${Math.round(stats.byPriority.p3 / stats.totalOpen * 100)}%)\n` +
        `  Unlabeled: ${stats.byPriority.unlabeled} (${Math.round(stats.byPriority.unlabeled / stats.totalOpen * 100)}%)\n\n` +
        `By Complexity:\n` +
        `  Low: ${stats.byComplexity.low} (${Math.round(stats.byComplexity.low / stats.totalOpen * 100)}%)\n` +
        `  Medium: ${stats.byComplexity.medium} (${Math.round(stats.byComplexity.medium / stats.totalOpen * 100)}%)\n` +
        `  High: ${stats.byComplexity.high} (${Math.round(stats.byComplexity.high / stats.totalOpen * 100)}%)\n` +
        `  Unlabeled: ${stats.byComplexity.unlabeled} (${Math.round(stats.byComplexity.unlabeled / stats.totalOpen * 100)}%)`;

      console.error(`[INFO] Stats calculated: ${stats.totalOpen} issues, ${stats.avgAge} days avg age`);

      return {
        content: [
          {
            type: 'text',
            text: summary,
          },
        ],
      };
    } catch (error: any) {
      console.error(`[ERROR] Triage stats failed: ${error.message}`);
      console.error(error.stack);

      return {
        content: [
          {
            type: 'text',
            text: `Triage stats failed: ${error.message}. Please check the server logs for details.`,
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
  console.error(`[INFO] Server version: 1.0.1`);
  
  // Verify required environment variables
  if (!process.env.GITHUB_TOKEN) {
    console.error('[WARN] GITHUB_TOKEN environment variable is not set');
  }
  if (!process.env.GOOGLE_API_KEY) {
    console.error('[WARN] GOOGLE_API_KEY environment variable is not set');
  }
  
  // Check if running in HTTP/SSE mode (for Archestra)
  const httpMode = process.env.MCP_TRANSPORT === 'sse' || process.argv.includes('--http');
  const port = parseInt(process.env.PORT || '3000', 10);
  
  if (httpMode) {
    console.error(`[INFO] Starting in HTTP/SSE mode on port ${port}`);
    
    const httpServer = http.createServer(async (req, res) => {
      if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('OK');
        return;
      }
      
      if (req.url === '/sse') {
        const transport = new SSEServerTransport('/message', res);
        await server.connect(transport);
        
        req.on('close', () => {
          transport.close();
        });
      } else {
        res.writeHead(404);
        res.end('Not Found');
      }
    });
    
    httpServer.listen(port, () => {
      console.error(`[INFO] Server listening on http://localhost:${port}/sse`);
      console.error('[INFO] Health check available at http://localhost:${port}/health');
      console.error('[INFO] Ready to accept triage requests');
    });
  } else {
    console.error('[INFO] Starting in stdio mode');
    const transport = new StdioServerTransport();
    await server.connect(transport);
    
    console.error('[INFO] Server connected via stdio transport');
    console.error('[INFO] Ready to accept triage requests');
  }
}

main().catch((error) => {
  console.error('[FATAL] Server startup failed:', error);
  process.exit(1);
});
