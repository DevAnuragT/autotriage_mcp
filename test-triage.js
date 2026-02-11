import { execSync } from 'child_process';
import * as fs from 'fs';

// Load environment variables from .env file
if (!fs.existsSync('.env')) {
  console.error('Error: .env file not found');
  console.error('Copy .env.example to .env and add your API keys');
  process.exit(1);
}

const env = fs.readFileSync('.env', 'utf8');
const envVars = {};
env.split('\n').forEach(line => {
  if (line.startsWith('GITHUB_TOKEN=')) {
    envVars.GITHUB_TOKEN = line.split('=')[1];
  } else if (line.startsWith('GOOGLE_API_KEY=')) {
    envVars.GOOGLE_API_KEY = line.split('=')[1];
  }
});

console.log('Testing MCP Server...\n');
console.log('Loaded Environment:');
console.log('- GITHUB_TOKEN:', envVars.GITHUB_TOKEN ? '✓ Set' : '✗ Missing');
console.log('- GOOGLE_API_KEY:', envVars.GOOGLE_API_KEY ? '✓ Set' : '✗ Missing');

// Test with a triage request (will use real GitHub API)
const triageRequest = {
  jsonrpc: '2.0',
  id: 1,
  method: 'tools/call',
  params: {
    name: 'triage_issue',
    arguments: {
      owner: 'DevAnuragT',
      repo: 'autotriage_mcp',
      issue_number: 1
    }
  }
};

console.log('\nSending triage request for issue #1...\n');

try {
  const result = execSync(`echo '${JSON.stringify(triageRequest)}' | node build/index.js 2>&1`, {
    env: { ...process.env, ...envVars },
    timeout: 30000,
    encoding: 'utf8'
  });
  
  console.log('Server Response:');
  console.log(result);
} catch (error) {
  console.log('Error:', error.message);
}
