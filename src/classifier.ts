import { GoogleGenerativeAI } from '@google/generative-ai';
import { withRetry } from './utils.js';

// P0 keyword patterns for heuristic override
const P0_KEYWORDS = [
  /crash(ed|ing)?/i,
  /security\s+(vulnerability|issue|bug|flaw)/i,
  /data\s+loss/i,
  /production\s+down/i,
  /critical\s+(bug|issue)/i,
  /severe/i,
  /urgent/i,
  /exploit/i,
  /CVE-\d+/i,
  /vulnerability/i,
];

export interface Classification {
  type: 'bug' | 'feature' | 'enhancement' | 'question';
  priority: 'P0' | 'P1' | 'P2' | 'P3';
  complexity: 'Low' | 'Medium' | 'High';
  reasoning: string;
}

/**
 * Truncate issue body to 2000 characters
 */
export function truncateIssueBody(body: string, maxLength: number = 2000): string {
  if (body.length <= maxLength) {
    return body;
  }
  return body.substring(0, maxLength) + '\n\n[... truncated for analysis]';
}

/**
 * Check for P0 keywords in issue title and body
 */
export function checkP0Keywords(title: string, body: string): boolean {
  const text = `${title} ${body}`;
  return P0_KEYWORDS.some(pattern => pattern.test(text));
}

/**
 * Classify issue using Gemini AI
 */
export async function classifyIssueWithGemini(
  title: string,
  body: string
): Promise<Classification> {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    throw new Error('GOOGLE_API_KEY environment variable is not set');
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const modelName = process.env.GEMINI_MODEL || 'gemini-1.5-flash';
  const model = genAI.getGenerativeModel({ model: modelName });

  console.error(`[INFO] Classifying issue with Gemini model: ${modelName}`);

  // Truncate body for token efficiency
  const truncatedBody = truncateIssueBody(body);

  // Build classification prompt
  const prompt = `You are a GitHub issue classifier. Analyze the following issue and return a JSON object with classification.

Issue Title: ${title}

Issue Body:
${truncatedBody}

Classify across three dimensions:

**Type** (choose one):
- bug → broken functionality, crashes, incorrect behavior
- feature → new capability request
- enhancement → improvement to existing feature
- question → clarification request

**Priority** (choose one):
- P0 → critical production issue, security vulnerability, data loss
- P1 → major user-facing bug, broken core functionality
- P2 → moderate issue or useful feature
- P3 → minor improvement or low-impact request

**Complexity** (choose one):
- Low → small change, config tweak, UI fix
- Medium → moderate logic change or integration
- High → architectural change or cross-system impact

Return ONLY a JSON object with this exact structure:
{
  "type": "bug|feature|enhancement|question",
  "priority": "P0|P1|P2|P3",
  "complexity": "Low|Medium|High",
  "reasoning": "brief explanation of classification"
}`;

  const result = await withRetry(async () => {
    return await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: 'application/json',
      },
    });
  });

  const response = result.response;
  const text = response.text();

  console.error(`[DEBUG] Gemini response: ${text}`);

  // Parse and validate response
  let classification: Classification;
  try {
    const parsed = JSON.parse(text);
    
    // Validate required fields
    if (!parsed.type || !parsed.priority || !parsed.complexity || !parsed.reasoning) {
      throw new Error('Missing required classification fields');
    }

    // Validate enum values
    const validTypes = ['bug', 'feature', 'enhancement', 'question'];
    const validPriorities = ['P0', 'P1', 'P2', 'P3'];
    const validComplexities = ['Low', 'Medium', 'High'];

    if (!validTypes.includes(parsed.type)) {
      throw new Error(`Invalid type: ${parsed.type}`);
    }
    if (!validPriorities.includes(parsed.priority)) {
      throw new Error(`Invalid priority: ${parsed.priority}`);
    }
    if (!validComplexities.includes(parsed.complexity)) {
      throw new Error(`Invalid complexity: ${parsed.complexity}`);
    }

    classification = parsed as Classification;
  } catch (error) {
    console.error(`[ERROR] Failed to parse Gemini response: ${error}`);
    // Fallback classification
    classification = {
      type: 'bug',
      priority: 'P2',
      complexity: 'Medium',
      reasoning: 'Classification failed, using default values',
    };
  }

  return classification;
}

/**
 * Map classification to kebab-case labels
 */
export function mapToKebabLabels(classification: Classification): string[] {
  return [
    `type-${classification.type}`,
    `priority-${classification.priority.toLowerCase()}`,
    `complexity-${classification.complexity.toLowerCase()}`,
  ];
}

/**
 * Generate triage summary comment in markdown
 */
export function generateTriageComment(classification: Classification): string {
  return `🔎 Issue Triage Summary

**Type:** ${classification.type}
**Priority:** ${classification.priority}
**Complexity:** ${classification.complexity}

**Reasoning:**
${classification.reasoning}

**Suggested Next Steps:**
${generateNextSteps(classification)}

---
*This triage was performed automatically. Re-running will update labels without duplicating this comment.*`;
}

/**
 * Generate suggested next steps based on classification
 */
function generateNextSteps(classification: Classification): string {
  const steps: string[] = [];

  // Priority-based steps
  if (classification.priority === 'P0') {
    steps.push('🚨 **Immediate attention required** - This is a critical issue');
    steps.push('Assign to on-call engineer or team lead');
    steps.push('Create incident response ticket if needed');
  } else if (classification.priority === 'P1') {
    steps.push('Review and assign to appropriate team member within 24 hours');
    steps.push('Add to current sprint if capacity allows');
  } else if (classification.priority === 'P2') {
    steps.push('Add to backlog for prioritization in next sprint planning');
    steps.push('Assess against current roadmap');
  } else {
    steps.push('Add to backlog for future consideration');
    steps.push('May be suitable for community contributions');
  }

  // Type-based steps
  if (classification.type === 'bug') {
    steps.push('Verify reproduction steps');
    steps.push('Add relevant test cases to prevent regression');
  } else if (classification.type === 'feature') {
    steps.push('Gather requirements and create technical design if approved');
    steps.push('Estimate effort and dependencies');
  } else if (classification.type === 'question') {
    steps.push('Provide clear answer or point to relevant documentation');
    steps.push('Consider if documentation needs improvement');
  }

  return steps.map((step, i) => `${i + 1}. ${step}`).join('\n');
}

/**
 * Main classification function with heuristic override
 */
export async function classifyIssue(title: string, body: string): Promise<Classification> {
  // Check for P0 keywords first (heuristic override)
  if (checkP0Keywords(title, body)) {
    console.error(`[INFO] P0 keyword detected - applying heuristic override`);
    
    // Still call Gemini for type/complexity, but force P0
    const classification = await classifyIssueWithGemini(title, body);
    return {
      ...classification,
      priority: 'P0',
      reasoning: `P0 override applied due to critical keywords. ${classification.reasoning}`,
    };
  }

  // Normal Gemini classification
  return await classifyIssueWithGemini(title, body);
}
