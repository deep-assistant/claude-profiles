#!/bin/bash

# Test script to verify watch mode exits on size issues
# This simulates a scenario where the profile becomes too large

echo "🧪 Testing watch mode size limit exit behavior"
echo "============================================="

echo "This test verifies that watch mode:"
echo "1. Shows archive size during saves (like store mode)" 
echo "2. Exits when profile becomes too large"
echo ""

echo "To test this manually:"
echo "1. Create a large ~/.claude directory (> 40MB when compressed)"
echo "2. Run: node claude-profiles.mjs --watch test-profile --skip-projects"
echo "3. Make a change to trigger a save"
echo "4. Verify that:"
echo "   - Archive size is displayed: '📦 Archive created: X.X MB'"
echo "   - If too large, watch mode exits with appropriate message"
echo ""

echo "Creating a test script that generates large files..."

cat << 'EOF' > examples/create-large-claude-dir.sh
#!/bin/bash

# WARNING: This will create large files in ~/.claude for testing
# Run this only in a test environment!

echo "Creating large files in ~/.claude for size testing..."

# Backup original directory if it exists
if [ -d ~/.claude.backup.original ]; then
    echo "Backup already exists at ~/.claude.backup.original"
else
    if [ -d ~/.claude ]; then
        mv ~/.claude ~/.claude.backup.original
        echo "Original ~/.claude backed up to ~/.claude.backup.original"
    fi
fi

# Create test .claude directory
mkdir -p ~/.claude

# Create basic required files
echo '{"test": "config"}' > ~/.claude.json
echo '{"backup": true}' > ~/.claude.json.backup
mkdir -p ~/.claude
echo '{"access_token": "fake", "refresh_token": "fake"}' > ~/.claude/.credentials.json

# Create large files to exceed size limit
echo "Creating large test files (this may take a moment)..."
for i in {1..10}; do
    dd if=/dev/zero of=~/.claude/large_file_$i.dat bs=1M count=5 2>/dev/null
done

echo "Large test environment created!"
echo "To restore original: mv ~/.claude.backup.original ~/.claude"
EOF

chmod +x examples/create-large-claude-dir.sh

echo "✅ Test scripts created in examples/"
echo "   - create-large-claude-dir.sh: Creates large test environment"
echo "   - Manual testing required for watch mode behavior"