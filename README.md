# GitHub Issue Triage MCP Server

An intelligent GitHub issue triage assistant powered by Google Gemini AI, built as a Model Context Protocol (MCP) server.

## Features

- 🤖 **AI-Powered Classification** — Uses Google Gemini to analyze issue title and body
- 🏷️ **Smart Labeling** — Automatically applies structured labels (type, priority, complexity)
- 🎯 **Heuristic Overrides** — Detects critical keywords (crash, security, data loss) for instant P0 classification
- 💬 **Structured Comments** — Posts formatted triage summaries with reasoning and next steps
- ♻️ **Idempotent** — Re-running updates labels without duplicating comments
- ⚡ **Retry Logic** — Exponential backoff for rate limit handling (GitHub & Gemini APIs)
- 🔒 **Error Handling** — Hybrid strategy with controlled failures and graceful degradation

## Classification System

### Type
- `type-bug` → Broken functionality, crashes, incorrect behavior
- `type-feature` → New capability request
- `type-enhancement` → Improvement to existing feature
- `type-question` → Clarification request

### Priority
- `priority-p0` → Critical (production down, security vulnerability, data loss)
- `priority-p1` → High (major user-facing bug, broken core functionality)
- `priority-p2` → Medium (moderate issue or useful feature)
- `priority-p3` → Low (minor improvement, nice-to-have)

### Complexity
- `complexity-low` → Small change, config tweak, UI fix
- `complexity-medium` → Moderate logic change or integration
- `complexity-high` → Architectural change or cross-system impact

## Installation

### Prerequisites

- Node.js 18+ (with npm)
- GitHub Personal Access Token (PAT)
- Google Gemini API Key

### Setup

1. **Clone and install dependencies:**

```bash
git clone https://github.com/DevAnuragT/autotriage_mcp.git
cd autotriage_mcp
npm install
```

2. **Build the project:**

```bash
npm run build
```

3. **Configure environment variables:**

Copy `.env.example` to `.env` and fill in your credentials:

```bash
cp .env.example .env
```

Edit `.env`:

```bash
# GitHub Personal Access Token
# Create at: https://github.com/settings/tokens
# Required scopes: repo (or public_repo for public repos)
GITHUB_TOKEN=ghp_your_github_token_here

# Google Gemini API Key
# Create at: https://aistudio.google.com/app/apikey
GOOGLE_API_KEY=your_google_api_key_here

# Optional: Gemini Model (default: gemini-1.5-flash)
# GEMINI_MODEL=gemini-1.5-flash
```

### Obtaining API Keys

**GitHub Personal Access Token:**
1. Go to https://github.com/settings/tokens
2. Click "Generate new token" → "Generate new token (classic)"
3. Select scopes:
   - `repo` (for private repositories)
   - OR `public_repo` (for public repositories only)
4. Copy the generated token

**Google Gemini API Key:**
1. Go to https://aistudio.google.com/app/apikey
2. Click "Create API Key"
3. Copy the generated key
4. Free tier available with rate limits (15 RPM for Flash models)

## Usage

### MCP Client Configuration

Add this server to your MCP client configuration (e.g., Claude Desktop, Cline):

**Claude Desktop (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):**

```json
{
  "mcpServers": {
    "github-triage": {
      "command": "node",
      "args": ["/absolute/path/to/autotriage_mcp/build/index.js"],
      "env": {
        "GITHUB_TOKEN": "ghp_your_github_token_here",
        "GOOGLE_API_KEY": "your_google_api_key_here"
      }
    }
  }
}
```

**Or using npm global install:**

```bash
npm install -g .
```

Then in your MCP client config:

```json
{
  "mcpServers": {
    "github-triage": {
      "command": "github-triage-server",
      "env": {
        "GITHUB_TOKEN": "ghp_your_github_token_here",
        "GOOGLE_API_KEY": "your_google_api_key_here"
      }
    }
  }
}
```

### Using the Tool

Once configured, the `triage_issue` tool will be available in your MCP client:

**Example prompt to Claude:**

```
Triage issue #42 in the repository owner/repo-name
```

The tool requires three parameters:
- `owner` — GitHub repository owner/organization
- `repo` — GitHub repository name
- `issue_number` — Issue number to triage

**What happens:**
1. Fetches issue details from GitHub
2. Analyzes title and body using Gemini AI
3. Checks for P0 keywords (crash, security, data loss)
4. Classifies by type, priority, and complexity
5. Removes old triage labels (`type-*`, `priority-*`, `complexity-*`)
6. Applies new labels
7. Posts a triage summary comment (if not already present)

**Idempotency:** Re-running triage on the same issue updates labels without duplicating comments.

## Example Output

When you run triage on an issue, the tool will:

1. **Apply labels** like:
   - `type-bug`
   - `priority-p1`
   - `complexity-medium`

2. **Post a comment** like:

```markdown
🔎 Issue Triage Summary

**Type:** bug
**Priority:** P1
**Complexity:** Medium

**Reasoning:**
The issue describes a crash in the authentication module when users attempt to log in with 
special characters in their password. This is a critical bug affecting core functionality.

**Suggested Next Steps:**
1. Review and assign to appropriate team member within 24 hours
2. Add to current sprint if capacity allows
3. Verify reproduction steps
4. Add relevant test cases to prevent regression

---
*This triage was performed automatically. Re-running will update labels without duplicating this comment.*
```

## Development

**Watch mode (auto-rebuild on changes):**

```bash
npm run dev
```

**Manual build:**

```bash
npm run build
```

**Directory structure:**

```
autotriage_mcp/
├── src/
│   ├── index.ts       # MCP server and tool handler
│   ├── github.ts      # GitHub API integration
│   ├── classifier.ts  # Gemini AI classification
│   └── utils.ts       # Retry logic utilities
├── build/             # Compiled JavaScript output
├── package.json
├── tsconfig.json
├── .env.example       # Environment variable template
└── README.md
```

## Architecture

### Hybrid Error Handling

**🟢 Controlled Failures** (return structured error response):
- Invalid input (malformed owner, negative issue number)
- Resource not found (404 - issue doesn't exist)
- Authentication failures (401/403 - invalid token)
- Rate limiting (429 - handled with retry logic)

**🔴 Unexpected Failures** (throw exception):
- Network errors
- API service unavailable
- Internal server errors
- JSON parse errors

### Exponential Backoff Retry

Automatically retries on rate limit errors (429) from GitHub and Gemini APIs:
- **Attempt 1:** Immediate
- **Attempt 2:** Wait 1 second
- **Attempt 3:** Wait 2 seconds
- **Attempt 4:** Wait 4 seconds (max)

### P0 Keyword Heuristics

Before calling Gemini, the system checks for critical keywords:
- `crash`, `security`, `vulnerability`, `data loss`
- `production down`, `critical bug`, `severe`
- `urgent`, `exploit`, `CVE-*`

If detected, priority is automatically set to `P0`.

## Cost Optimization

- **Gemini Free Tier:** 15 requests per minute (RPM) for Flash models
- **Issue Body Truncation:** Limited to 2000 characters to reduce token usage
- **Keyword Pre-filtering:** P0 detection before LLM call reduces API costs by ~20-40%

## Troubleshooting

### "GITHUB_TOKEN environment variable is not set"
- Ensure you've created a `.env` file or set the environment variable in your MCP client config
- Verify the token has the correct scopes (`repo` or `public_repo`)

### "GOOGLE_API_KEY environment variable is not set"
- Ensure you've added your Gemini API key to `.env` or MCP client config
- Verify the API key is valid at https://aistudio.google.com/app/apikey

### "Rate limit exceeded"
- The server automatically retries with exponential backoff
- If limits persist, wait a few minutes before retrying
- Free tier: 15 RPM for Gemini Flash models

### "Issue not found" or "Authentication failed"
- Verify the repository owner, name, and issue number are correct
- Check that your GitHub token has access to the repository
- For private repos, ensure your token has `repo` scope (not just `public_repo`)

## License

MIT

## Contributing

Issues and pull requests are welcome! This tool is designed for hackathons and production use.

---

**This tool is idempotent — re-running triage updates labels without duplicating comments.**
