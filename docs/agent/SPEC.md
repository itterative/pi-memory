# pi-memory specification

A memory system extension for pi that gives the agent persistent, structured recall across sessions.

## Storage Layout

### Project Level (relative to project root)

```
.pi/
  agent/
    memory/
      architecture.md          # Self-describing memory file
      conventions.md           # Self-describing memory file
      ...
```

### User Level (global)

```
~/.pi/
  agent/
    memory/
      preferences.md           # Self-describing memory file
      ...
```

There is no index file. The extension scans the `memory/` directories and reads frontmatter from each `.md` file to build the index dynamically. This ensures the index is always in sync with the actual files.

## File Formats

### memory/[MEMORY].md

Each memory file uses YAML frontmatter for metadata, following the same convention as pi skills (`SKILL.md`). The body is free-form markdown.

```markdown
---
name: architecture
description: Key architectural decisions, patterns, and module layout
---

# Architecture

## Decisions

- Using event-sourced pattern for order processing
- PostgreSQL for read models, Kafka for event streaming

## Key Modules

- `src/orders/` - Order aggregate and handlers
- `src/events/` - Event definitions and serialization
```

#### Frontmatter Fields

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Matches the filename (without `.md`). Lowercase, hyphens allowed. |
| `description` | Yes | One-line summary. Used in the system prompt to help the agent decide whether to load this memory. |

Files without valid frontmatter trigger a warning during discovery.

## Agent Behavior

### System Prompt Injection

On `session_start`, the extension scans both `memory/` directories, reads frontmatter from each `.md` file, and builds a system prompt appendix. This appendix is cached for the lifetime of the session.

On `before_agent_start`, the cached appendix is appended to the system prompt. The extension does **not** re-scan the directories on each turn. This means:

- Memories created or updated during a session are not reflected in the system prompt until the next session (or `/reload`)
- The agent discovers new or updated memories by reading files directly with the `read` tool
- No file I/O happens on each agent turn — only on session start

The injected instructions describe:

- The memory system exists and how files are structured
- Where to find memory files (project-level and user-level)
- The current list of memories with descriptions (generated from frontmatter)
- The agent should load specific memories on demand using `read`
- The agent should save useful information proactively at the project level
- The agent should only write to user-level memories when the user explicitly asks

### Session Entry Caching

When session entry caching is enabled (default), the extension persists the memory index in the session using `pi.appendEntry()`. On `session_start` (including `/reload`), it first looks for a previously stored entry in `ctx.sessionManager.getEntries()`, using the last match. If found, the cached index is reused without re-scanning the filesystem. If not found (e.g. first session), a fresh scan is performed and the result is stored via `appendEntry`.

When session entry caching is disabled, the extension uses a module-level variable that is rebuilt from the filesystem on every `session_start`.

Set the environment variable `PI_MEMORY_SESSION_CACHE=false` to disable session entry caching.

### Reading Memories

The agent uses the built-in `read` tool. No custom tools needed.

Workflow:
1. The system prompt lists available memories with descriptions
2. The agent reads specific `memory/[MEMORY].md` files as needed

### Writing Memories (Project Level)

The agent uses built-in `edit` and `write` tools. No custom tools needed.

The agent should proactively save project-level memories when:
- It learns something about the project that would be useful in future sessions (architecture, conventions, gotchas)
- The user asks it to remember something

To save a memory:
1. Create or update `memory/[MEMORY].md` with frontmatter (`name`, `description`) and content

To delete a memory:
1. Remove the file (the agent can use `bash` with `rm`)

No index file needs to be updated — the extension re-scans on next session start.

### Writing Memories (User Level)

Same mechanism, but the agent must **only** write to `~/.pi/agent/memory/` when the user explicitly asks. The agent should not autonomously save user-level memories.

## Open Questions

- **`/memory` command:** A slash command for users to quickly view or manage memories. Planned for a future release.
- **Memory pruning:** Bundled as `skills/memory-prune/SKILL.md`, declared in `package.json` under `pi.skills`. Users invoke via `/skill:memory-prune`.

