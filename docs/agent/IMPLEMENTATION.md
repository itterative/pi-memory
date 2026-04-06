# pi-memory Implementation Plan

## Architecture

Single extension file (`index.ts`) with no external dependencies beyond pi's APIs and Node.js built-ins.

## Extension Lifecycle

### `session_start`

1. Resolve paths:
   - Project: `<cwd>/.pi/agent/memory/`
   - User: `~/.pi/agent/memory/`
2. Create `memory/` directories if missing
3. If session entry caching is enabled (default, controlled by `PI_MEMORY_SESSION_CACHE` env var):
   - Scan `ctx.sessionManager.getEntries()` for the last entry with `customType: "pi-memory"`
   - If found and paths match, reuse the cached index (no filesystem scan)
   - If not found, perform a fresh scan and store via `pi.appendEntry("pi-memory", ...)`
4. If session entry caching is disabled (`PI_MEMORY_SESSION_CACHE=false`):
   - Scan both directories for `.md` files and parse frontmatter (always)
5. Warn the user via `ctx.ui.notify` for any files with invalid frontmatter
6. Build and cache the system prompt appendix string

### `before_agent_start`

1. Append the cached system prompt appendix to `event.systemPrompt`
2. Return the modified prompt
3. No file I/O — use the cached string

### `/reload` handling

`session_start` fires with `reason: "reload"`. Behavior depends on caching mode:

- **Session cache enabled:** The stored entry persists in the session, so the index is restored without re-scanning the filesystem.
- **Session cache disabled:** Directories are re-scanned and the module variable is rebuilt from scratch.

## System Prompt Appendix

Built once per session from scanned frontmatter. Structure:

```
## Memory System

You have access to a persistent memory system for storing and recalling information across sessions.

### Locations

- Project-level: .pi/agent/memory/*.md
- User-level: ~/.pi/agent/memory/*.md

### How It Works

- Each memory file has YAML frontmatter with `name` and `description`
- Use the `read` tool to load specific memories as needed
- Use `write` to create new memories (include frontmatter) or `edit` to update existing ones
- Use `bash` with `rm` to delete a memory file

### Rules

- Proactively save project-level memories when you learn something useful about the project
- Only write to user-level memories (~/.pi/agent/memory/) when the user explicitly asks

### Available Project Memories

- **architecture** - Key architectural decisions, patterns, and module layout
- **conventions** - Code style and naming conventions

### Available User Memories

- **preferences** - Editor and tool preferences
```

If no memories exist at either level, show "None" under that heading.

## Frontmatter Parsing

Minimal YAML frontmatter parser — extract content between `---` delimiters, parse `name` and `description` fields. Throws `FrontmatterParseError` with the file path and specific reason when frontmatter is missing or incomplete. No need for a full YAML library; the format is simple enough to handle with regex.

```typescript
interface MemoryMeta {
    name: string;
    description: string;
}

class FrontmatterParseError extends Error {
    constructor(
        public readonly filePath: string,
        reason: string,
    ) { ... }
}

function parseFrontmatter(content: string, filePath: string): MemoryMeta {
    // Throws FrontmatterParseError if delimiters missing, or name/description fields absent
}

interface ScanResult {
    memories: MemoryMeta[];
    errors: FrontmatterParseError[];
}

function scanMemories(dir: string): Promise<ScanResult> {
    // Read directory, filter .md files, parse frontmatter
    // Collects FrontmatterParseErrors instead of skipping silently
}
```

## Caching Modes

### Module-variable cache (`PI_MEMORY_SESSION_CACHE=false`)

The memory index is stored in a module-level variable. Rebuilt from the filesystem on every `session_start`.

### Session entry cache (default, `PI_MEMORY_SESSION_CACHE`)

The memory index is persisted in the session via `pi.appendEntry("pi-memory", ...)`. On `session_start`, the extension looks for the last matching entry in `ctx.sessionManager.getEntries()`.

```typescript
interface CachedMemoryIndex {
    projectDir: string;
    userDir: string;
    projectMemories: MemoryMeta[];
    userMemories: MemoryMeta[];
}
```

Benefits: avoids unnecessary filesystem I/O on `/reload` and avoids invalidating the provider's KV cache when no memory files have changed.

## Extension Hooks

The extension subscribes to:

1. `session_start` — ensure directories exist, scan files (or restore from session entry), cache prompt appendix
2. `before_agent_start` — append cached prompt appendix to system prompt

No custom tools registered — the agent uses built-in `read`, `edit`, `write`.

## File Structure

```
pi-memory/
  index.ts              # Extension entry point (all logic here)
  test/
    index.test.ts       # Unit and integration tests
  docs/
    agent/
      SPEC.md           # Specification
      IMPLEMENTATION.md # This file
```

## Implementation Steps

1. ~~Create frontmatter parser and directory scanner~~
2. ~~Create `session_start` handler — resolve paths, create directories, scan files, build cache~~
3. ~~Create `before_agent_start` handler — append cached prompt~~
4. ~~Add `FrontmatterParseError` with user warnings on invalid files~~
5. ~~Add session entry caching behind `--session-cache` flag~~
6. ~~Switch to `PI_MEMORY_SESSION_CACHE` env var, default enabled~~
6. Test with a manual pi session — verify prompt injection, directory creation, agent reads/writes memories correctly

## Out of Scope (v1)

- Memory pruning or staleness detection
- Embedding memory contents directly in the prompt (descriptions only — agent loads details on demand)
