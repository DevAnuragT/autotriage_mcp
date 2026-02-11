# Quick Start Guide

## ✅ Installation Complete!

Your GitHub Issue Triage MCP Server is ready to use.

## Current Status

- ✅ Dependencies installed
- ✅ TypeScript compiled successfully
- ✅ MCP server initialized and tested
- ⚠️ API keys not configured (required for actual triage)

## Next Steps

### 1. Configure API Keys

Create a `.env` file from the template:

```bash
cp .env.example .env
```

Edit `.env` and add your credentials:

```bash
# Get from: https://github.com/settings/tokens
GITHUB_TOKEN=ghp_your_token_here

# Get from: https://aistudio.google.com/app/apikey
GOOGLE_API_KEY=your_api_key_here
```

### 2. Configure MCP Client

#### For Claude Desktop (macOS)

Edit `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "github-triage": {
      "command": "node",
      "args": ["/home/anurag/hack/mcp/build/index.js"],
      "env": {
        "GITHUB_TOKEN": "ghp_your_token_here",
        "GOOGLE_API_KEY": "your_api_key_here"
      }
    }
  }
}
```

#### For Claude Desktop (Linux)

Edit `~/.config/Claude/claude_desktop_config.json` with the same configuration.

#### For Other MCP Clients

Refer to your client's documentation for adding custom MCP servers.

### 3. Test the Tool

Once configured in your MCP client, try:

**Example prompt to Claude:**
```
Triage issue #1 in DevAnuragT/autotriage_mcp
```

This will:
1. Fetch the issue from GitHub
2. Classify it using Gemini AI
3. Apply appropriate labels (type-*, priority-*, complexity-*)
4. Post a structured triage summary comment

### 4. Understanding the Output

The tool will apply labels like:
- `type-bug` / `type-feature` / `type-enhancement` / `type-question`
- `priority-p0` / `priority-p1` / `priority-p2` / `priority-p3`
- `complexity-low` / `complexity-medium` / `complexity-high`

And post a comment like:

```markdown
🔎 Issue Triage Summary

**Type:** bug
**Priority:** P1
**Complexity:** Medium

**Reasoning:**
[AI-generated analysis of the issue]

**Suggested Next Steps:**
1. Review and assign to appropriate team member
2. Add to current sprint if capacity allows
...
```

## Development Commands

```bash
# Rebuild after code changes
npm run build

# Watch mode (auto-rebuild)
npm run dev

# Test server initialization
./test-server.sh
```

## Troubleshooting

### Server won't start
- Check that Node.js 18+ is installed: `node --version`
- Verify build succeeded: `ls build/index.js`
- Check for TypeScript errors: `npm run build`

### "GITHUB_TOKEN not set" warning
- This is normal if you haven't configured `.env` yet
- The server will start but triage operations will fail
- Add your GitHub token to fix this

### Rate limits
- Free tier: 15 requests/minute for Gemini Flash
- GitHub: 5000 requests/hour for authenticated users
- The server automatically retries with exponential backoff

### Issue not found
- Verify the repository and issue number are correct
- Check your GitHub token has access to the repository
- For private repos, ensure token has `repo` scope

## Example Usage

```bash
# In Claude Desktop or MCP client, send:
"Triage issue #123 in owner/repo-name"

# The tool will respond with:
"Successfully triaged issue #123. Classified as: bug (P1, Medium).
Labels applied: type-bug, priority-p1, complexity-medium. 
Triage comment posted."
```

## Repository Structure

```
/home/anurag/hack/mcp/
├── src/              # TypeScript source code
│   ├── index.ts      # MCP server & tool handler
│   ├── github.ts     # GitHub API integration
│   ├── classifier.ts # Gemini AI classification
│   └── utils.ts      # Retry utilities
├── build/            # Compiled JavaScript (auto-generated)
├── package.json      # Dependencies & scripts
├── tsconfig.json     # TypeScript configuration
├── .env.example      # Environment variables template
├── .env              # Your API keys (create this!)
└── README.md         # Full documentation
```

## Features Implemented

✅ AI-powered classification using Gemini Flash
✅ P0 keyword heuristics (crash, security, data loss)
✅ Smart label management (removes old, applies new)
✅ Idempotent operations (no duplicate comments)
✅ Exponential backoff retry logic
✅ Hybrid error handling (controlled + unexpected)
✅ Structured triage comments with reasoning
✅ Stderr logging (preserves stdio protocol)
✅ Issue body truncation (2000 chars for cost optimization)

## API Key Setup Links

- **GitHub PAT**: https://github.com/settings/tokens
- **Gemini API Key**: https://aistudio.google.com/app/apikey

## Support

For issues or questions:
- Check the main [README.md](README.md) for detailed documentation
- Review server logs (stderr output)
- Verify API keys are valid and have correct scopes

---

**Ready to triage! 🚀**
