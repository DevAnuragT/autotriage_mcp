# Testing Guide - GitHub Issue Triage MCP Server

## Quick Test (2 minutes)

### 1. Verify Server Starts
```bash
cd autotriage_mcp  # or wherever you cloned it
source .env
timeout 3s node build/index.js
```

**Expected output (stderr):**
```
[INFO] Starting GitHub Triage MCP Server
[INFO] Server version: 1.0.0
[INFO] Server connected via stdio transport
[INFO] Ready to accept triage requests
```

### 2. Test Tools Listing
```bash
./demo-triage.sh
```

**Expected output:**
```
✓ Tools endpoint working!
```

---

## Full End-to-End Test (5 minutes)

### Prerequisites
- `.env` file configured with valid `GITHUB_TOKEN` and `GOOGLE_API_KEY`
- An existing GitHub issue in your repository

### Step 1: Verify Environment
```bash
cat .env | grep -E "GITHUB_TOKEN|GOOGLE_API_KEY"
```

**Expected:** Both variables should show values (not empty)

### Step 2: Start MCP Server
```bash
export GITHUB_TOKEN=$(grep GITHUB_TOKEN .env | cut -d= -f2)
export GOOGLE_API_KEY=$(grep GOOGLE_API_KEY .env | cut -d= -f2)
node build/index.js
```

Server will now listen on stdin/stdout. Keep this terminal open.

### Step 3: Send Triage Request (New Terminal)
```bash
# Create JSON-RPC request to list tools
cat > request.json << 'EOF'
{"jsonrpc":"2.0","id":1,"method":"tools/list"}
EOF

# Send to server
cat request.json | node build/index.js 2>&1 | head -50
```

**Expected:** JSON response showing `triage_issue` tool with full schema

### Step 4: Test Actual Triage (if issue exists)
```bash
# Create triage request for your issue
cat > triage_request.json << 'EOF'
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/call",
  "params": {
    "name": "triage_issue",
    "arguments": {
      "owner": "DevAnuragT",
      "repo": "autotriage_mcp",
      "issue_number": 1
    }
  }
}
EOF

# Send request
export GITHUB_TOKEN=$(grep GITHUB_TOKEN .env | cut -d= -f2)
export GOOGLE_API_KEY=$(grep GOOGLE_API_KEY .env | cut -d= -f2)
cat triage_request.json | node build/index.js 2>&1
```

**Expected output (if issue exists):**
- Server logs to stderr: `[INFO] Starting triage for DevAnuragT/autotriage_mcp#1`
- JSON-RPC response with triage results

---

## Testing in Claude Desktop

### 1. Configure MCP Server
Edit `~/.config/Claude/claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "github-triage": {
      "command": "node",
      "args": ["$(pwd)/build/index.js"],
      "env": {
        "GITHUB_TOKEN": "your_token_here",
        "GOOGLE_API_KEY": "your_api_key_here"
      }
    }
  }
}
```

**OR use the full path to wherever you cloned the repo:**
```json
{
  "mcpServers": {
    "github-triage": {
      "command": "node",
      "args": ["/path/to/autotriage_mcp/build/index.js"],
      "env": {
        "GITHUB_TOKEN": "your_token_here",
        "GOOGLE_API_KEY": "your_api_key_here"
      }
    }
  }
}
```

### 2. Restart Claude Desktop

### 3. Test in Chat
Ask Claude:
```
Triage issue #1 in DevAnuragT/autotriage_mcp
```

**Expected:** Claude will use the `triage_issue` tool and report:
- Classification (type, priority, complexity)
- Labels applied
- Triage comment posted (if new)

---

## Troubleshooting Tests

### Server won't start
```bash
# Check Node version
node --version  # Should be 18+

# Check build exists
ls build/index.js

# Check TypeScript errors
npm run build
```

### "API key not set" error
```bash
# Verify .env has values
cat .env

# Verify export worked
echo $GITHUB_TOKEN
echo $GOOGLE_API_KEY
```

### GitHub API 403 error
- Token scope too limited (need `repo` for private repos)
- Create new token at: https://github.com/settings/tokens

### Gemini API errors
- Check API key is valid at: https://aistudio.google.com/app/apikey
- Check quota isn't exceeded (free tier: 15 RPM)

---

## Automated Test Script
```bash
#!/bin/bash

echo "🧪 Testing MCP Server..."
echo ""

# Test 1: Build
echo "1️⃣ Building..."
npm run build || exit 1

# Test 2: Server start
echo "2️⃣ Testing server startup..."
timeout 3s node build/index.js > /dev/null 2>&1 || exit 1

# Test 3: Tools listing
echo "3️⃣ Testing tools endpoint..."
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | \
  timeout 3s node build/index.js 2>&1 | grep -q "triage_issue" || exit 1

echo ""
echo "✅ All tests passed!"
```

Save as `run-tests.sh` and run:
```bash
chmod +x run-tests.sh
./run-tests.sh
```

---

## What Each Test Verifies

| Test | What It Checks |
|------|----------------|
| Server start | Environment variables loaded, MCP protocol ready |
| Tools listing | Tool schema is valid, parameters documented |
| Triage call | GitHub API works, Gemini AI responds, labels applied |
| Claude integration | MCP client can call tool successfully |

---

## Success Indicators

✅ Server logs `[INFO] Ready to accept triage requests`
✅ `tools/list` returns `triage_issue` with full schema
✅ `triage_issue` with valid params returns results
✅ Labels appear on GitHub issues
✅ Comments posted to issues

---

## Next Steps

1. **Test locally** with `./demo-triage.sh` ← Start here
2. **Create test issue** in your repo
3. **Configure Claude Desktop** with your API keys
4. **Run triage command** in Claude: `"Triage issue #1 in owner/repo"`
5. **Verify on GitHub** - check labels and comment on the issue

---
