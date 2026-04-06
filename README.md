# pi-memory

A memory extension for [pi](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent) that gives the agent persistent, structured recall across sessions.

## Overview

pi-memory scans memory files at two locations and injects their descriptions into the agent's system prompt at session start. The agent can then load specific memories on demand and proactively save new ones.

- **Project-level** memories live in `.pi/agent/memory/*.md` (relative to your project root)
- **User-level** memories live in `~/.pi/agent/memory/*.md` (shared across all projects)

Use `/skill:memory-prune` in order to ask the agent to review the current memories and prune them accordingly.

Each memory file is a markdown file with YAML frontmatter:

```markdown
---
name: architecture
description: Key architectural decisions, patterns, and module layout
---

# Architecture

- Using event-sourced pattern for order processing
- PostgreSQL for read models, Kafka for event streaming
```

## Configuration

| Environment Variable      | Default | Description                                                                                   |
| ------------------------- | ------- | --------------------------------------------------------------------------------------------- |
| `PI_MEMORY_SESSION_CACHE` | `true`  | Cache the memory index in the session entry to avoid re-scanning the filesystem on `/reload`. |

Set to `false` to force a fresh filesystem scan on every session start.

## License

[MIT](LICENSE)
