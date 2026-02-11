#!/bin/bash
# Test script to verify MCP server initialization

echo "Testing GitHub Triage MCP Server..."
echo ""
echo "Starting server (should show initialization logs to stderr)..."
echo ""

# Run the server with a simple test (will exit after showing init logs)
# We'll send EOF immediately to test if it starts correctly
echo '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test-client","version":"1.0.0"}},"id":1}' | timeout 2s node build/index.js 2>&1 || true

echo ""
echo "If you saw initialization logs above, the server is working!"
echo ""
echo "Next steps:"
echo "1. Copy .env.example to .env and add your API keys"
echo "2. Configure your MCP client (Claude Desktop, etc.)"
echo "3. Start using the triage_issue tool!"
