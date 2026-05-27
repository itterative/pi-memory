import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { scanMemories, type MemoryMeta } from "./utils/memories";
import { FrontmatterParseError } from "./utils/frontmatter";

interface CachedMemoryIndex {
    projectDir: string;
    userDir: string;
    projectMemories: MemoryMeta[];
    userMemories: MemoryMeta[];
}

const ENTRY_TYPE = "pi-memory:memory-index";

function formatMemoryList(memories: MemoryMeta[]): string {
    return memories.length > 0 ? memories.map((m) => `- **${m.name}** - ${m.description}`).join("\n") : "None";
}

function buildPromptAppendix(
    projectMemories: MemoryMeta[],
    userMemories: MemoryMeta[],
    projectDir: string,
    userDir: string,
): string {
    const projectLines = formatMemoryList(projectMemories);
    const userLines = formatMemoryList(userMemories);

    return `## Memory System

You have access to a persistent memory system for storing and recalling information across sessions.

### Locations

- Project-level: ${projectDir}/*.md
- User-level: ${userDir}/*.md

### How to use

- Each memory file has YAML frontmatter with \`name\` and \`description\`
- Use the \`read\` tool to load specific memories as needed
- Use \`write\` to create new memories (include frontmatter) or \`edit\` to update existing ones
- Use \`bash\` with \`rm\` to delete a memory file

### Guidelines

- Read memories depending on the task given to you by the user
- Only write to user-level memories when the user explicitly asks
- Proactively save project-level memories when you learn something useful about the project
  - Before finishing your task, review what you have learned
  - Add new memories or edit existing ones to keep them consistent with any changes made

### Available Project Memories

${projectLines}

### Available User Memories

${userLines}`;
}

export default function (pi: ExtensionAPI) {
    let cachedAppendix = "";
    let maxContextTokens = 0;
    let currentBaseline = 0;
    let currentStreamedChars = 0;

    pi.on("session_start", async (event, ctx) => {
        const projectDir = join(ctx.cwd, ".pi", "agent", "memory");
        const userDir = join(homedir(), ".pi", "agent", "memory");

        // Ensure directories exist
        await mkdir(projectDir, { recursive: true });
        await mkdir(userDir, { recursive: true });

        const useSessionCache = process.env.PI_MEMORY_SESSION_CACHE !== "false";

        let projectMemories: MemoryMeta[];
        let userMemories: MemoryMeta[];
        let allErrors: FrontmatterParseError[];

        if (useSessionCache) {
            // Try to restore from session entries (last match)
            const entries = ctx.sessionManager.getEntries();
            let cached: CachedMemoryIndex | undefined;
            for (let i = entries.length - 1; i >= 0; i--) {
                const entry = entries[i];
                if (entry.type === "custom" && entry.customType === ENTRY_TYPE) {
                    cached = entry.data as CachedMemoryIndex;
                    break;
                }
            }

            if (cached && cached.projectDir === projectDir && cached.userDir === userDir) {
                projectMemories = cached.projectMemories;
                userMemories = cached.userMemories;
                allErrors = [];
            } else {
                const [projectResult, userResult] = await Promise.all([
                    scanMemories(projectDir),
                    scanMemories(userDir),
                ]);
                projectMemories = projectResult.memories;
                userMemories = userResult.memories;
                allErrors = [...projectResult.errors, ...userResult.errors];

                pi.appendEntry(ENTRY_TYPE, {
                    projectDir,
                    userDir,
                    projectMemories,
                    userMemories,
                } satisfies CachedMemoryIndex);
            }
        } else {
            const [projectResult, userResult] = await Promise.all([scanMemories(projectDir), scanMemories(userDir)]);
            projectMemories = projectResult.memories;
            userMemories = userResult.memories;
            allErrors = [...projectResult.errors, ...userResult.errors];
        }

        if (allErrors.length > 0 && ctx.hasUI) {
            for (const error of allErrors) {
                ctx.ui.notify(`pi-memory: ${error.message}`, "warning");
            }
        }

        // Build and cache the prompt appendix
        cachedAppendix = buildPromptAppendix(projectMemories, userMemories, projectDir, userDir);
    });

    pi.on("agent_start", async (_event, _ctx) => {
        maxContextTokens = 0;
    });

    pi.on("message_start", async (event, ctx) => {
        if (event.message.role !== "assistant") return;
        const usage = ctx.getContextUsage();
        currentBaseline = usage?.tokens ?? 0;
        currentStreamedChars = 0;
        if (currentBaseline > maxContextTokens) {
            maxContextTokens = currentBaseline;
        }
    });

    pi.on("message_update", async (event, _ctx) => {
        if (event.message.role !== "assistant") return;
        const ev = event.assistantMessageEvent;
        if (ev.type === "text_delta" || ev.type === "thinking_delta") {
            currentStreamedChars += ev.delta.length;
        }
        const estimated = currentBaseline + Math.ceil(currentStreamedChars / 4);
        if (estimated > maxContextTokens) {
            maxContextTokens = estimated;
        }
    });

    pi.on("before_agent_start", async (event, _ctx) => {
        if (!cachedAppendix) return;

        const memoryBlock = `<memory_system>\n${cachedAppendix}\n</memory_system>`;
        let systemPrompt = event.systemPrompt;
        const projectContextEnd = "</project_context>";
        const idx = systemPrompt.indexOf(projectContextEnd);
        if (idx !== -1) {
            systemPrompt =
                systemPrompt.slice(0, idx + projectContextEnd.length) +
                "\n\n" +
                memoryBlock +
                "\n" +
                systemPrompt.slice(idx + projectContextEnd.length);
        } else {
            systemPrompt = systemPrompt + "\n" + memoryBlock;
        }

        const result: { systemPrompt: string; message?: { customType: string; content: string; display: boolean } } = {
            systemPrompt,
        };

        if (!event.systemPromptOptions) {
            return result;
        }

        const reminderEnabled = process.env.PI_MEMORY_REMINDER === "true";
        const threshold = parseInt(process.env.PI_MEMORY_REMINDER_THRESHOLD ?? "15000", 10);
        const triggered = reminderEnabled && maxContextTokens >= threshold;

        if (reminderEnabled) {
            pi.appendEntry("pi-memory:debug", {
                reminderEnabled,
                threshold,
                maxContextTokens,
                triggered,
            });
        }

        if (triggered) {
            result.message = {
                customType: "pi-memory",
                content:
                    "<memory_reminder>\nRefer to the <memory_system> section in your system prompt for available memories and usage guidelines.\n</memory_reminder>",
                display: false,
            };
        }

        return result;
    });
}
