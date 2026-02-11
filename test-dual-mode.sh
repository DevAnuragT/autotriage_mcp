#!/bin/bash
# Test script for dual-mode MCP server

set -e

echo "=== Testing Dual-Mode GitHub Issue Triage MCP Server ==="
echo ""

# Load environment variables
if [ ! -f .env ]; then
  echo "Error: .env file not found. Please create one from .env.example"
  exit 1
fi

export GITHUB_TOKEN=$(grep GITHUB_TOKEN .env | cut -d= -f2)
export GOOGLE_API_KEY=$(grep GOOGLE_API_KEY .env | cut -d= -f2)

echo "✓ Environment variables loaded"
echo ""

# Test 1: List tools
echo "=== Test 1: List Available Tools ==="
cat > /tmp/list_tools.json << 'EOF'
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/list"
}
EOF

echo "Request:"
cat /tmp/list_tools.json | jq .
echo ""

echo "Response:"
timeout 5 node build/index.js < /tmp/list_tools.json 2>/dev/null | jq .
echo ""

# Test 2: Contributor Mode - Search for beginner issues
echo "=== Test 2: Contributor Mode - Search Issues ==="
cat > /tmp/contributor_test.json << 'EOF'
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/call",
  "params": {
    "name": "triage_issue",
    "arguments": {
      "mode": "contributor",
      "owner": "microsoft",
      "repo": "vscode",
      "labels": ["good first issue"],
      "limit": 3
    }
  }
}
EOF

echo "Request:"
cat /tmp/contributor_test.json | jq .
echo ""

echo "Response (first 30 lines):"
timeout 15 node build/index.js < /tmp/contributor_test.json 2>/dev/null | head -30
echo ""

echo "=== Tests Complete ==="
echo ""
echo "Note: Maintainer mode requires 'repo' scope to test with actual label/comment operations."
echo "      You can test it manually with your own repositories where you have write access."
