# Testing Watch Mode Log Reduction

## Before Changes
When running `./claude-profiles.mjs --watch test-profile`, the output would include:

- Directory tree on startup (can be large for big projects)
- DEBUG messages for every file change detection
- TRACE messages for debouncing and timeouts
- DEBUG messages for save progress
- DEBUG messages for each watched path
- DEBUG/TRACE messages for macOS keychain monitoring

## After Changes
Now watch mode logs are much cleaner:

### Normal Mode (without --verbose)
Only shows essential messages:
- Startup messages
- Changes detected and save confirmations
- Error messages
- Statistics (watching N paths for changes)

### Verbose Mode (with --verbose)
Shows all the detailed debugging information for troubleshooting:
- Directory tree display
- DEBUG messages for file changes
- TRACE messages for internal state
- Details about what paths are being watched
- Keychain monitoring messages on macOS

## Usage Examples

### Quiet watch mode (recommended for regular use):
```bash
./claude-profiles.mjs --watch my-profile
```

### Verbose watch mode (for debugging):
```bash
./claude-profiles.mjs --watch my-profile --verbose
```

This change maintains full debugging capability when needed while providing a cleaner experience for normal usage.