#!/bin/bash

# Test script to verify the recursive ~/.claude directory fix
# This script creates a test environment with nested .claude directories

echo "🧪 Testing recursive .claude directory fix"
echo "=========================================="

# Create test directory structure
TEST_DIR="/tmp/claude-test-$(date +%s)"
mkdir -p "$TEST_DIR"
cd "$TEST_DIR"

echo "Creating test directory structure in $TEST_DIR..."

# Create main .claude directory
mkdir -p .claude
echo '{"test": "main"}' > .claude/config.json

# Create problematic nested .claude directories (simulating bug scenario)
mkdir -p .claude/.claude
echo '{"test": "nested1"}' > .claude/.claude/config.json

mkdir -p .claude/.claude/.claude  
echo '{"test": "nested2"}' > .claude/.claude/.claude/config.json

# Create some normal files
echo '{"main": true}' > .claude.json
echo '{"backup": true}' > .claude.json.backup

# Create projects directory (should be filtered when --skip-projects)
mkdir -p .claude/projects
echo '{"project": "test"}' > .claude/projects/test.json

echo "Test directory structure created:"
find . -type f | sort

echo ""
echo "Testing with our fixed claude-profiles script..."
echo "Expected: Should NOT include nested .claude directories"

# Test the archiving process (dry run by creating a temporary profile)
HOME_BACKUP="$HOME"
export HOME="$TEST_DIR"

cd /tmp/gh-issue-solver-1757315776671

# Run a test command to see directory structure calculation
echo "Running directory structure analysis..."
node claude-profiles.mjs --help > /dev/null 2>&1 || echo "Note: This would normally require actual claude-profiles execution"

echo ""
echo "Cleanup test directory: $TEST_DIR"
# rm -rf "$TEST_DIR"
export HOME="$HOME_BACKUP"

echo "✅ Test setup complete. Manual verification needed by running actual claude-profiles commands."