# GitHub Issue Triage MCP Server

> **Built for Archestra** — An enterprise-grade MCP server demonstrating production-ready AI automation that scales across organizations.

An intelligent GitHub issue triage assistant powered by Google Gemini AI, built as a Model Context Protocol (MCP) server with dual-mode operation and full MCP protocol support. Designed to showcase Archestra's ability to orchestrate, secure, and scale AI agents.

## Key Highlights for Archestra

- **Archestra-Native Design** — SSE/HTTP transport integrates seamlessly with Archestra's MCP Gateway
- **Production Ready** — Multi-stage Docker build, health checks, Kubernetes manifests included
- **Full MCP Protocol** — Tools, Resources, Prompts (demonstrates complete MCP capabilities)
- **Real AI Value** — Dual-mode operation serving both maintainers and contributors
- **Observable & Manageable** — Built-in metrics, health endpoints, structured logging

## Demo

![Demo Coming Soon](https://via.placeholder.com/800x400/1a1a1a/ffffff?text=Demo+GIF+Coming+Soon)

## Features

### Dual Operation Modes

**Maintainer Mode** — Full triage automation
- AI-powered classification with Google Gemini
- Automatic label application (type, priority, complexity)
- Structured triage summary comments
- Idempotent operations (re-run safe)

**Contributor Mode** — Issue discovery & recommendations
- Search and filter open issues by labels
- Smart ranking by beginner-friendliness
- Complexity estimation from existing labels
- Skill-fit scoring for contributors

### Comprehensive Toolset

- **`triage_issue`** — Dual-mode triage: full automation (maintainer) or issue search (contributor)
- **`batch_triage`** — Triage all open issues in a repository at once
- **`triage_stats`** — Repository health metrics and analytics

### MCP Resources

- **`triage://stats/{owner}/{repo}`** — Real-time repository statistics as MCP resources
  - Issue counts by type, priority, complexity
  - Staleness metrics (>30 days inactive)
  - Average issue age

### MCP Prompts

Pre-built prompt templates for common workflows:
- **`triage-issue`** — Triage a specific issue
- **`find-beginner-issues`** — Discover good first issues
- **`repo-health-check`** — Comprehensive repository analysis

### Archestra Platform Integration

- **SSE/HTTP Transport** — Works with Archestra's MCP Gateway
- **Docker Support** — Containerized deployment with multi-stage builds
- **Kubernetes Ready** — Deploy to Archestra orchestrator
- **Health Checks** — Built-in `/health` endpoint

### Advanced Features

- **Heuristic Overrides** — P0 detection for crash/security/data-loss keywords
- **Retry Logic** — Exponential backoff for GitHub & Gemini rate limits
- **Hybrid Error Handling** — Graceful degradation with controlled failures
- **Rate Limit Aware** — Respects API quotas (GitHub 5000/hr, Gemini 15 RPM)

## Why This Matters for Archestra

**Problem:** Enterprise teams need AI agents that can automate operational tasks like issue triage, but deploying AI across an organization is complex—requiring security management, observability, scaling, and governance.

**Solution:** This MCP server demonstrates how Archestra solves this:

| Feature | Benefit |
|---------|---------|
| **SSE/HTTP Transport** | Connects to Archestra's MCP Gateway for centralized management |
| **Docker Container** | Deploy consistently across Archestra's infrastructure |
| **Health Checks** | Archestra monitors server health automatically |
| **Structured Logging** | Archestra observes and audits AI operations |
| **Rate Limiting** | Server respects API quotas while Archestra enforces org-level controls |
| **Dual-Mode Operation** | Shows how MCP servers can serve different roles (maintainer/contributor) |
| **Full MCP Protocol** | Tools, Resources, Prompts showcase complete MCP capabilities |

**Result:** Teams use Archestra to deploy this triage server to their GitHub enterprise, and it automatically manages agent deployment, scaling, security, and observability—all without custom infrastructure.

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

## 🛠️ All Tools

### 1. `triage_issue` — Dual-Mode Triage

**Maintainer Mode** — Full automated triage
```typescript
{
  mode: "maintainer",
  owner: "octocat",
  repo: "hello-world",
  issue_number: 42
}
```

**Contributor Mode** — Find beginner-friendly issues
```typescript
{
  mode: "contributor",
  owner: "octocat",
  repo: "hello-world",
  labels: ["good first issue", "help wanted"],
  limit: 10
}
```

### 2. `batch_triage` — Bulk Repository Triage

Triage all open issues in a repository at once:

```typescript
{
  owner: "octocat",
  repo: "hello-world",
  dry_run: false  // Set to true to preview without applying labels
}
```

**Output:** Summary statistics showing:
- Total issues triaged
- Breakdown by type (bug, feature, docs, etc.)
- Priority distribution (P0-P3)
- Complexity distribution (low/medium/high)

**Rate Limiting:** Automatically throttles to respect:
- GitHub API: 5000 requests/hour
- Gemini API: 15 requests/minute (free tier)

### 3. `triage_stats` — Repository Health Metrics

Get comprehensive statistics about a repository's open issues:

```typescript
{
  owner: "octocat",
  repo: "hello-world"
}
```

**Metrics provided:**
- Total open issues
- By type: bugs, features, docs, questions, other
- By priority: P0 (critical), P1 (high), P2 (medium), P3 (low)
- By complexity: low, medium, high
- Beginner-friendly count (good first issue, help wanted)
- Stale issues (>30 days inactive)
- Average issue age in days

## MCP Resources

Access real-time repository statistics as MCP resources:

```
triage://stats/{owner}/{repo}
```

**Example in Claude Desktop:**
```
Read the resource triage://stats/modelcontextprotocol/servers
```

Returns JSON with comprehensive health metrics that can be analyzed by AI agents.

## MCP Prompts

Pre-built templates for common workflows:

### `triage-issue`
Triage a specific issue with AI classification.

**Arguments:**
- `owner` — Repository owner
- `repo` — Repository name
- `issue_number` — Issue to triage

### `find-beginner-issues`
Discover good first issues for new contributors.

**Arguments:**
- `owner` — Repository owner
- `repo` — Repository name

### `repo-health-check`
Comprehensive repository health analysis.

**Arguments:**
- `owner` — Repository owner
- `repo` — Repository name

**Usage in Claude Desktop:**
```
Use the find-beginner-issues prompt for modelcontextprotocol/servers
```

## 🐳 Archestra Platform Integration

This server is purpose-built to run in Archestra's platform. Here's how to deploy:

### 1. Using Archestra's MCP Gateway

**Archestra Configuration (`archestra-config.json`):**
```json
{
  "mcpServers": {
    "github-triage": {
      "url": "http://autotriage-mcp:3000/sse",
      "transport": "sse",
      "description": "GitHub issue triage powered by Gemini AI"
    }
  }
}
```

### 2. Docker Deployment (Local Testing)

**Build the image:**
```bash
docker build -t autotriage-mcp:v1.1.0 .
```

**Run for development:**
```bash
docker run -d \
  -e GITHUB_TOKEN=$(cat ~/.github_token) \
  -e GOOGLE_API_KEY=$(cat ~/.gemini_key) \
  -e MCP_TRANSPORT=sse \
  -p 3000:3000 \
  --name autotriage-mcp \
  autotriage-mcp:v1.1.0

# Verify it's running
curl http://localhost:3000/health
```

**Run in background with docker-compose:**
```bash
docker-compose up -d
```

**Or use docker-compose:**
```bash
# Create .env file with GITHUB_TOKEN and GOOGLE_API_KEY
docker-compose up -d
```

**Health check:**
```bash
curl http://localhost:3000/health
```

**SSE endpoint:**
```
http://localhost:3000/sse
```

### 3. Kubernetes Deployment (Archestra Orchestrator)

This manifest deploys the server to Archestra's Kubernetes cluster with proper secret management and observability:

**Prerequisites:**
- Kubernetes cluster running in Archestra environment
- Secrets configured:
  ```bash
  kubectl create secret generic github-credentials --from-literal=token=ghp_...
  kubectl create secret generic gemini-credentials --from-literal=api-key=AIza...
  ```

**Deployment manifest:**
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: autotriage-mcp
  namespace: default
spec:
  replicas: 2  # Archestra can scale based on load
  selector:
    matchLabels:
      app: autotriage-mcp
  template:
    metadata:
      labels:
        app: autotriage-mcp
    spec:
      containers:
      - name: mcp-server
        image: registry.archestra.ai/autotriage-mcp:1.1.0
        imagePullPolicy: Always
        ports:
        - containerPort: 3000
          name: http
        env:
        - name: MCP_TRANSPORT
          value: "sse"
        - name: PORT
          value: "3000"
        - name: NODE_ENV
          value: "production"
        - name: GITHUB_TOKEN
          valueFrom:
            secretKeyRef:
              name: github-credentials
              key: token
        - name: GOOGLE_API_KEY
          valueFrom:
            secretKeyRef:
              name: gemini-credentials
              key: api-key
        livenessProbe:
          httpGet:
            path: /health
            port: 3000
          initialDelaySeconds: 10
          periodSeconds: 30
          timeoutSeconds: 5
        readinessProbe:
          httpGet:
            path: /health
            port: 3000
          initialDelaySeconds: 5
          periodSeconds: 10
        resources:
          requests:
            cpu: "100m"
            memory: "128Mi"
          limits:
            cpu: "500m"
            memory: "512Mi"
---
apiVersion: v1
kind: Service
metadata:
  name: autotriage-mcp-svc
spec:
  selector:
    app: autotriage-mcp
  ports:
  - port: 3000
    targetPort: 3000
    name: sse
  type: ClusterIP
```

**Deploy to Archestra:**
```bash
kubectl apply -f autotriage-deployment.yaml

# Verify deployment
kubectl get pods -l app=autotriage-mcp
kubectl logs -f deployment/autotriage-mcp

# Access via Archestra's MCP Gateway
# (Archestra handles the routing)
```

**Benefits of This Deployment:**
- Automatic Scaling — Archestra scales replicas based on demand
- Health Monitoring — Kubernetes probes feed into Archestra's observability
- Secret Management — Credentials stored in Kubernetes secrets
- Load Balancing — Multiple replicas for high availability
- Rolling Updates — Zero-downtime deployments
- Resource Management — CPU/memory limits prevent runaway costs

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

**Controlled Failures** (return structured error response):
- Invalid input (malformed owner, negative issue number)
- Resource not found (404 - issue doesn't exist)
- Authentication failures (401/403 - invalid token)
- Rate limiting (429 - handled with retry logic)

**Unexpected Failures** (throw exception):
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
