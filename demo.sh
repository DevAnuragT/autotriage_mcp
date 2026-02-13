#!/bin/bash

# Demo script for autotriage-mcp
# Shows both contributor and maintainer modes

set -e

echo "🎬 autotriage-mcp Demo"
echo "====================="
echo ""

# Check if environment is set up
if [ -z "$GITHUB_TOKEN" ] || [ -z "$GOOGLE_API_KEY" ]; then
    echo "❌ Error: GITHUB_TOKEN and GOOGLE_API_KEY must be set"
    exit 1
fi

echo "📦 Using repository: modelcontextprotocol/servers"
echo ""

# Demo 1: Contributor Mode - Find beginner issues
echo "🔍 Demo 1: Contributor Mode - Finding beginner-friendly issues"
echo "================================================================"
echo ""
echo "$ echo '{\"method\":\"tools/call\",\"params\":{\"name\":\"triage_issue\",\"arguments\":{\"mode\":\"contributor\",\"owner\":\"modelcontextprotocol\",\"repo\":\"servers\",\"labels\":[\"good first issue\"],\"limit\":5}}}' | node build/index.js"
echo ""

echo '{"method":"tools/call","params":{"name":"triage_issue","arguments":{"mode":"contributor","owner":"modelcontextprotocol","repo":"servers","labels":["good first issue"],"limit":5}}}' | timeout 30s node build/index.js || true

echo ""
echo "✅ Found and ranked beginner-friendly issues!"
echo ""
sleep 2

# Demo 2: Triage Stats
echo "📊 Demo 2: Repository Health Check - Triage Statistics"
echo "========================================================"
echo ""
echo "$ echo '{\"method\":\"tools/call\",\"params\":{\"name\":\"triage_stats\",\"arguments\":{\"owner\":\"modelcontextprotocol\",\"repo\":\"servers\"}}}' | node build/index.js"
echo ""

echo '{"method":"tools/call","params":{"name":"triage_stats","arguments":{"owner":"modelcontextprotocol","repo":"servers"}}}' | timeout 30s node build/index.js || true

echo ""
echo "✅ Repository statistics generated!"
echo ""

echo "🎉 Demo complete! Try it yourself:"
echo "   npm install -g autotriage-mcp"
echo "   autotriage-mcp"
