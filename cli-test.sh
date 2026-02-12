#!/bin/bash
# CLI testing script for GitHub Triage MCP Server

# Load environment variables
if [ -f .env ]; then
  export $(grep -v '^#' .env | xargs)
fi

echo "=== GitHub Triage MCP Server - CLI Test ==="
echo ""

# Function to call the tool
call_tool() {
  local json_request="$1"
  echo "$json_request" | timeout 10 node build/index.js 2>&1 | grep -A 1000 '"result"\|"error"' | jq -r '.result.content[0].text // .error.message // .'
}

# Show menu
echo "Select mode:"
echo "1. Contributor Mode - Find beginner-friendly issues"
echo "2. Maintainer Mode - Triage an issue with AI"
echo "3. List Tools"
echo ""
read -p "Enter choice (1-3): " choice

case $choice in
  1)
    read -p "Repository owner: " owner
    read -p "Repository name: " repo
    read -p "Filter labels (comma-separated, or leave empty): " labels_input
    read -p "Max results (default 10): " limit
    limit=${limit:-10}
    
    # Parse labels
    if [ -z "$labels_input" ]; then
      labels_json="[]"
    else
      IFS=',' read -ra LABELS <<< "$labels_input"
      labels_json="["
      for i in "${!LABELS[@]}"; do
        labels_json+="\"${LABELS[$i]}\""
        if [ $i -lt $((${#LABELS[@]} - 1)) ]; then
          labels_json+=","
        fi
      done
      labels_json+="]"
    fi
    
    echo ""
    echo "Searching for issues..."
    call_tool '{
      "jsonrpc": "2.0",
      "id": 1,
      "method": "tools/call",
      "params": {
        "name": "triage_issue",
        "arguments": {
          "mode": "contributor",
          "owner": "'"$owner"'",
          "repo": "'"$repo"'",
          "labels": '"$labels_json"',
          "limit": '"$limit"'
        }
      }
    }'
    ;;
    
  2)
    read -p "Repository owner: " owner
    read -p "Repository name: " repo
    read -p "Issue number: " issue_number
    
    echo ""
    echo "Triaging issue #$issue_number..."
    call_tool '{
      "jsonrpc": "2.0",
      "id": 1,
      "method": "tools/call",
      "params": {
        "name": "triage_issue",
        "arguments": {
          "mode": "maintainer",
          "owner": "'"$owner"'",
          "repo": "'"$repo"'",
          "issue_number": '"$issue_number"'
        }
      }
    }'
    ;;
    
  3)
    echo ""
    echo "Listing available tools..."
    call_tool '{
      "jsonrpc": "2.0",
      "id": 1,
      "method": "tools/list"
    }'
    ;;
    
  *)
    echo "Invalid choice"
    exit 1
    ;;
esac
