---
name: project-structure
description: File layout conventions for pi-memory — source files are at the repository root, not in src/
---

# Project Structure

- All TypeScript source files live at the **repository root** (e.g. `index.ts`, `utils/*.ts`). There is no `src/` directory.
- Supporting non-code files also live at the root, next to `index.ts`.
- Config files (`tsconfig.json`, `package.json`, `vitest.config.*`) are at the root as well.
- The `skills/` directory is at the root for pi skill definitions.
