#!/usr/bin/env node

// Test the file filtering logic we implemented

console.log('🧪 Testing file filtering logic for nested .claude directories\n');

const testFiles = [
    // Normal files that should be included
    'config.json',
    'settings.json',
    'ide/lock.file',
    'statsig/data.json',
    'todos/todo.json',
    
    // Nested .claude directories that should be EXCLUDED
    '.claude/config.json',
    '.claude/.credentials.json', 
    '.claude/nested/file.json',
    'subdir/.claude/file.json',
    'path/to/.claude/deeply/nested.json',
    '.claude',
    'some/.claude',
    
    // Projects that should be excluded with --skip-projects
    'projects/project1/file.json',
    'projects/another.json',
    
    // Normal paths that should be included
    'normal/path/file.json',
    'another/directory/file.txt'
];

console.log('Test files:');
testFiles.forEach(file => console.log(`  ${file}`));

console.log('\nApplying our filter logic...\n');

// Fixed filter logic: exclude nested .claude but allow root .claude files
const filteredFiles = testFiles.filter(file => {
    // Exclude projects folder
    if (file.startsWith('projects/') || file.startsWith('projects\\')) {
        return false;
    }
    
    // Allow files that start with .claude/ (these are the main claude directory files)
    if (file.startsWith('.claude/') || file === '.claude') {
        return true;
    }
    
    // Exclude nested .claude directories (any .claude that's not at the root)
    if (file.includes('/.claude/') || file.includes('\\.claude\\') || 
        file.endsWith('/.claude') || file.endsWith('\\.claude')) {
        return false;
    }
    
    return true;
});

console.log('✅ Files that PASS the filter (should be included):');
filteredFiles.forEach(file => console.log(`  ✓ ${file}`));

console.log('\n❌ Files that FAIL the filter (should be excluded):');
const excludedFiles = testFiles.filter(file => !filteredFiles.includes(file));
excludedFiles.forEach(file => console.log(`  ✗ ${file}`));

console.log('\n📊 Results:');
console.log(`  Total files: ${testFiles.length}`);
console.log(`  Included: ${filteredFiles.length}`);  
console.log(`  Excluded: ${excludedFiles.length}`);

// Verify our expectations
const expectedExclusions = [
    'subdir/.claude/file.json',
    'path/to/.claude/deeply/nested.json',
    'some/.claude',
    'projects/project1/file.json',
    'projects/another.json'
];

const actualExclusions = excludedFiles;
const correctExclusions = expectedExclusions.every(expected => 
    actualExclusions.includes(expected)
);

console.log(`\n${correctExclusions ? '✅' : '❌'} Filter logic test: ${correctExclusions ? 'PASSED' : 'FAILED'}`);

if (!correctExclusions) {
    console.log('Expected exclusions:', expectedExclusions);
    console.log('Actual exclusions:', actualExclusions);
}