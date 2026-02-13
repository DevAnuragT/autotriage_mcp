import { Octokit } from '@octokit/rest';
import type { RestEndpointMethodTypes } from '@octokit/rest';
import { withRetry } from './utils.js';

const TRIAGE_COMMENT_SIGNATURE = '🔎 Issue Triage Summary';
const TRIAGE_LABEL_PATTERNS = /^(type|priority|complexity)-/;

/**
 * Get Octokit client with GitHub token (lazy initialization)
 */
function getOctokit(): Octokit {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error('GITHUB_TOKEN environment variable is not set');
  }
  return new Octokit({ auth: token });
}

export interface IssueData {
  title: string;
  body: string;
  labels: string[];
  number: number;
}

/**
 * Fetch issue details from GitHub
 */
export async function fetchIssue(
  owner: string,
  repo: string,
  issueNumber: number
): Promise<IssueData> {
  console.error(`[INFO] Fetching issue #${issueNumber} from ${owner}/${repo}`);
  
  const octokit = getOctokit();
  
  const response = await withRetry(async () => {
    return await octokit.rest.issues.get({
      owner,
      repo,
      issue_number: issueNumber,
    });
  });

  const issue = response.data;
  const labels = issue.labels.map((label: any) => 
    typeof label === 'string' ? label : label.name
  ).filter((name): name is string => typeof name === 'string');

  return {
    title: issue.title,
    body: issue.body || '',
    labels,
    number: issue.number,
  };
}

/**
 * Check if a triage comment already exists
 */
export async function checkExistingTriageComment(
  owner: string,
  repo: string,
  issueNumber: number
): Promise<boolean> {
  console.error(`[INFO] Checking for existing triage comment on issue #${issueNumber}`);
  
  const octokit = getOctokit();
  
  const response = await withRetry(async () => {
    return await octokit.rest.issues.listComments({
      owner,
      repo,
      issue_number: issueNumber,
    });
  });

  return response.data.some((comment: RestEndpointMethodTypes['issues']['listComments']['response']['data'][number]) => 
    comment.body?.includes(TRIAGE_COMMENT_SIGNATURE)
  );
}

/**
 * Remove existing triage labels (type-*, priority-*, complexity-*)
 */
export async function removeTriageLabels(
  owner: string,
  repo: string,
  issueNumber: number,
  currentLabels: string[]
): Promise<void> {
  const triageLabels = currentLabels.filter(label => 
    TRIAGE_LABEL_PATTERNS.test(label)
  );

  if (triageLabels.length === 0) {
    console.error(`[INFO] No existing triage labels to remove`);
    return;
  }

  console.error(`[INFO] Removing ${triageLabels.length} existing triage labels`);
  
  const octokit = getOctokit();
  
  for (const label of triageLabels) {
    await withRetry(async () => {
      await octokit.rest.issues.removeLabel({
        owner,
        repo,
        issue_number: issueNumber,
        name: label as string,
      });
    });
  }
}

/**
 * Apply labels to an issue (with deduplication)
 */
export async function applyLabels(
  owner: string,
  repo: string,
  issueNumber: number,
  labels: string[]
): Promise<void> {
  // Deduplicate labels (case-insensitive)
  const uniqueLabels = labels.reduce((acc, label) => {
    const normalized = label.toLowerCase().trim();
    if (!acc.some(l => l.toLowerCase() === normalized)) {
      acc.push(label.trim());
    }
    return acc;
  }, [] as string[]);

  if (uniqueLabels.length === 0) {
    console.error(`[WARN] No labels to apply`);
    return;
  }

  console.error(`[INFO] Applying ${uniqueLabels.length} labels: ${uniqueLabels.join(', ')}`);
  
  const octokit = getOctokit();
  
  await withRetry(async () => {
    await octokit.rest.issues.addLabels({
      owner,
      repo,
      issue_number: issueNumber,
      labels: uniqueLabels,
    });
  });
}

/**
 * Post a triage summary comment
 */
export async function postComment(
  owner: string,
  repo: string,
  issueNumber: number,
  body: string
): Promise<void> {
  console.error(`[INFO] Posting triage comment on issue #${issueNumber}`);
  
  const octokit = getOctokit();
  
  await withRetry(async () => {
    await octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: issueNumber,
      body,
    });
  });
}
/**
 * Search for open issues (contributor mode)
 */
export async function searchOpenIssues(
  owner: string,
  repo: string,
  labels?: string[],
  limit: number = 10
): Promise<GitHubIssue[]> {
  console.error(`[INFO] Searching for open issues in ${owner}/${repo}`);
  
  const octokit = getOctokit();
  
  // Build search query
  let query = `repo:${owner}/${repo} is:open is:issue`;
  if (labels && labels.length > 0) {
    query += ` label:${labels.join(' label:')}`;
  }
  
  const response = await withRetry(async () => {
    return await octokit.rest.search.issuesAndPullRequests({
      q: query,
      per_page: limit,
      sort: 'updated',
      order: 'desc',
    });
  });

  return response.data.items.map((issue: any) => ({
    number: issue.number,
    title: issue.title,
    body: issue.body || '',
    labels: issue.labels.map((label: any) =>
      typeof label === 'string' ? label : label.name
    ).filter((label: any): label is string => typeof label === 'string'),
    comments: issue.comments,
    assignee: issue.assignee,
    created_at: issue.created_at,
    updated_at: issue.updated_at,
  })) as GitHubIssue[];
}

export interface GitHubIssue {
  number: number;
  title: string;
  body: string;
  labels: string[];
  comments?: number;
  assignee?: any;
  created_at: string;
  updated_at: string;
}