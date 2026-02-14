# Testing Guide

Comprehensive testing procedures for the GitHub Issue Triage MCP Server.

## Quick Start (2 minutes)

### Verify Server Starts
```bash
cd autotriage_mcp  # or wherever you cloned it
source .env
timeout 3s node build/index.js
```

**Expected output (stderr):**
```
[INFO] Starting GitHub Triage MCP Server
[INFO] Server version: 1.1.0
[INFO] Server connected via stdio transport
[INFO] Ready to accept triage requests
```

### Test Tools Listing
```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | node build/index.js 2>&1 | head -30
```

**Expected:** JSON response listing triage_issue, batch_triage, and triage_stats tools

---

## Full End-to-End Test

### Prerequisites
- .env file configured with valid GITHUB_TOKEN and GOOGLE_API_KEY
- Test repository with at least one GitHub issue

### Step 1: Verify Environment
```bash
cat .env | grep -E "GITHUB_TOKEN|GOOGLE_API_KEY"
```

**Expected:** Both variables display non-empty values

### Step 2: Start MCP Server
```bash
export GITHUB_TOKEN=$(grep GITHUB_TOKEN .env | cut -d= -f2)
export GOOGLE_API_KEY=$(grep GOOGLE_API_KEY .env | cut -d= -f2)
node build/index.js
```

**Expected output (keep terminal open):**
```
[INFO] Starting GitHub Triage MCP Server
[INFO] Server version: 1.1.0
[INFO] Server connected via stdio transport
[INFO] Ready to accept triage requests
```

### Step 3: List Available Tools (New Terminal)
```bash
cat > request.json << 'EOF'
{"jsonrpc":"2.0","id":1,"method":"tools/list"}
EOF

cat request.json | node build/index.js 2>&1 | head -50
```

**Expected:** JSON response with triage_issue, batch_triage, and triage_stats tool definitions

### Step 4: Test Maintainer Mode (Single Issue Triage)
```bash
cat > triage_request.json << 'EOF'
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/call",
  "params": {
    "name": "triage_issue",
    "arguments": {
      "mode": "maintainer",
      "owner": "YOUR_USERNAME",
      "repo": "YOUR_REPO",
      "issue_number": 1
    }
  }
}
EOF

cat triage_request.json | node build/index.js 2>&1
```

**Verification:**
- Server logs show issue fetch and classification
- GitHub issue receives type-*, priority-*, and complexity-* labels
- Triage comment posted to issue

### Step 5: Test Contributor Mode (Find Issues)
```bash
cat > contributor_request.json << 'EOF'
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "tools/call",
  "params": {
    "name": "triage_issue",
    "arguments": {
      "mode": "contributor",
      "owner": "octocat",
      "repo": "Hello-World",
      "labels": ["good first issue"],
      "limit": 5
    }
  }
}
EOF

cat contributor_request.json | node build/index.js 2>&1
```

**Expected:** Ranked list of beginner-friendly issues with complexity and skill-fit scores

### Step 6: Test Batch Triage
```bash
cat > batch_request.json << 'EOF'
{
  "jsonrpc": "2.0",
  "id": 4,
  "method": "tools/call",
  "params": {
    "name": "batch_triage",
    "arguments": {
      "owner": "octocat",
      "repo": "Hello-World",
      "dry_run": true
    }
  }
}
EOF

cat batch_request.json | node build/index.js 2>&1
```

**Expected:** Summary of issues that would be triaged (dry_run=true means no changes applied)

### Step 7: Test Repository Statistics
```bash
cat > stats_request.json << 'EOF'
{
  "jsonrpc": "2.0",
  "id": 5,
  "method": "tools/call",
  "params": {
    "name": "triage_stats",
    "arguments": {
      "owner": "octocat",
      "repo": "Hello-World"
    }
  }
}
EOF

cat stats_request.json | node build/index.js 2>&1
```

**Expected:** JSON with complete repository metrics (issue counts by type/priority/complexity, stale count, average age)

---

## Testing with Claude Desktop

### Configuration
Edit ~/.config/Claude/claude_desktop_config.json:

```json
{
  "mcpServers": {
    "github-triage": {
      "command": "node",
      "args": ["/absolute/path/to/autotriage_mcp/build/index.js"],
      "env": {
        "GITHUB_TOKEN": "your_github_token",
        "GOOGLE_API_KEY": "your_gemini_api_key"
      }
    }
  }
}
```

### Testing
1. Restart Claude Desktop
2. In chat, request: "Triage issue #1 in owner/repo"
3. Claude will call the triage_issue tool with maintainer mode
4. Verify on GitHub that labels and comment appear

**Expected:** Tool execution logs and triage summary in Claude response

---

## Troubleshooting

### Server fails to start
```bash
node --version  # Verify Node 18+
ls build/index.js  # Verify build artifact exists
npm run build  # Rebuild if needed
```

### API key errors
```bash
cat .env  # Verify credentials are set
echo $GITHUB_TOKEN  # Verify export worked
echo $GOOGLE_API_KEY  # Verify export worked
```

### GitHub API 403 (Unauthorized)
Token scope insufficient. Create new token at https://github.com/settings/tokens with repo scope.

### Gemini API rate limiting
Free tier limit is 15 requests per minute. Wait before retrying. Verify key at https://aistudio.google.com/app/apikey

---

## Automated Test Script

Save as test.sh:

```bash
#!/bin/bash
set -e

echo "Testing MCP Server"
echo ""

# Test 1: Build
echo "Building TypeScript..."
npm run build

# Test 2: Server startup
echo "Testing server startup..."
timeout 3s node build/index.js > /dev/null 2>&1 || true

# Test 3: Tools availability
echo "Verifying tools endpoint..."
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | \
  timeout 3s node build/index.js 2>&1 | grep -q "triage_issue" || exit 1

echo ""
echo "All basic tests passed"
```

Run:
```bash
chmod +x test.sh
./test.sh
```

---

## Test Coverage

| Test | Verifies |
|------|----------|
| Server startup | Environment variables, MCP protocol initialization |
| Tools listing | Tool schemas and parameter documentation |
| Maintainer mode | GitHub API, Gemini classification, label application |
| Contributor mode | Issue search, ranking, complexity estimation |
| Batch triage | Multi-issue processing, rate limit handling |
| Repository stats | Metric aggregation and calculation accuracy |

---

## Success Criteria

- Server logs: [INFO] Ready to accept triage requests
- tools/list returns all three tools: triage_issue, batch_triage, triage_stats
- triage_issue returns classification results
- GitHub issues receive appropriate labels (type-*, priority-*, complexity-*)
- Triage comments posted on issues with reasoning
- batch_triage processes multiple issues without errors
- triage_stats returns valid JSON with all metrics

---

## Testing Workflow

1. Verify environment with .env file
2. Start MCP server locally
3. Send test requests (tool/list, triage_issue, batch_triage, triage_stats)
4. Verify GitHub changes (labels, comments)
5. Test with Claude Desktop for end-to-end validation
6. Test Docker container deployment (production scenario)

For Archestra deployment testing, run Docker with MCP_TRANSPORT=sse and verify SSE endpoint at /sse

---
