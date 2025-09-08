#!/bin/bash

# Test script for --restore with --watch combination

echo "Testing --restore with --watch combination"
echo "==========================================="
echo ""

# Test 1: Basic restore with watch
echo "Test 1: Basic --restore with --watch"
echo "Command: ./claude-profiles.mjs --restore test-profile --watch test-profile --verbose"
timeout 5s ./claude-profiles.mjs --restore test-profile --watch test-profile --verbose 2>&1 | head -30
echo ""

# Test 2: Restore with watch and skip-projects
echo "Test 2: --restore with --watch and --skip-projects"
echo "Command: ./claude-profiles.mjs --restore test-profile --watch test-profile --skip-projects --verbose"
timeout 5s ./claude-profiles.mjs --restore test-profile --watch test-profile --skip-projects --verbose 2>&1 | head -30
echo ""

# Test 3: Just restore with skip-projects (no watch)
echo "Test 3: Just --restore with --skip-projects (no watch)"
echo "Command: ./claude-profiles.mjs --restore test-profile --skip-projects --verbose"
./claude-profiles.mjs --restore test-profile --skip-projects --verbose 2>&1 | head -30
echo ""

echo "Test completed!"