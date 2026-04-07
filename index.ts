import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { mkdir, readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

interface MemoryMeta {
    name: string;
    description: string;
}

class FrontmatterParseError extends Error {
    constructor(
        public readonly filePath: string,
        reason: string,
    ) {
        super(`${filePath}: ${reason}`);
        this.name = "FrontmatterParseError";
    }
}

function parseFrontmatter(content: string, filePath: string): MemoryMeta {
    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!match) {
        throw new FrontmatterParseError(filePath, "missing YAML frontmatter delimiters (---)");
    }

    const frontmatter = match[1];
    const nameMatch = frontmatter.match(/^name:\s*(.+)$/m);
    const descMatch = frontmatter.match(/^description:\s*(.+)$/m);

    if (!nameMatch) {
        throw new FrontmatterParseError(filePath, "missing required `name` field in frontmatter");
    }
    if (!descMatch) {
        throw new FrontmatterParseError(filePath, "missing required `description` field in frontmatter");
    }

    return {
        name: nameMatch[1].trim(),
        description: descMatch[1].trim(),
    };
}

interface ScanResult {
    memories: MemoryMeta[];
    errors: FrontmatterParseError[];
}

interface CachedMemoryIndex {
    projectDir: string;
    userDir: string;
    projectMemories: MemoryMeta[];
    userMemories: MemoryMeta[];
}

const ENTRY_TYPE = "pi-memory:memory-index";

async function scanMemories(dir: string): Promise<ScanResult> {
    if (!existsSync(dir)) return { memories: [], errors: [] };

    const entries = await readdir(dir);
    const memories: MemoryMeta[] = [];
    const errors: FrontmatterParseError[] = [];

    for (const entry of entries) {
        if (!entry.endsWith(".md")) continue;
        const filePath = join(dir, entry);
        try {
            const content = await readFile(filePath, "utf8");
            memories.push(parseFrontmatter(content, filePath));
        } catch (e) {
            if (e instanceof FrontmatterParseError) {
                errors.push(e);
            }
        }
    }

    return { memories, errors };
}

function buildPromptAppendix(
    projectMemories: MemoryMeta[],
    userMemories: MemoryMeta[],
    projectDir: string,
    userDir: string,
): string {
    const projectLines =
        projectMemories.length > 0
            ? projectMemories.map((m) => `- **${m.name}** - ${m.description}`).join("\n")
            : "None";

    const userLines =
        userMemories.length > 0 ? userMemories.map((m) => `- **${m.name}** - ${m.description}`).join("\n") : "None";

    return [
        "## Memory System",
        "",
        "You have access to a persistent memory system for storing and recalling information across sessions.",
        "",
        "### Locations",
        "",
        `- Project-level: ${projectDir}/*.md`,
        `- User-level: ${userDir}/*.md`,
        "",
        "### How It Works",
        "",
        "- Each memory file has YAML frontmatter with `name` and `description`",
        "- Use the `read` tool to load specific memories as needed",
        "- Use `write` to create new memories (include frontmatter) or `edit` to update existing ones",
        "- Use `bash` with `rm` to delete a memory file",
        "",
        "### Rules",
        "",
        "- Proactively save project-level memories when you learn something useful about the project",
        "- Only write to user-level memories when the user explicitly asks",
        "",
        "### Available Project Memories",
        "",
        projectLines,
        "",
        "### Available User Memories",
        "",
        userLines,
    ].join("\n");
}

export default function (pi: ExtensionAPI) {
    let cachedAppendix = "";

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

    pi.on("before_agent_start", async (event, _ctx) => {
        if (!cachedAppendix) return;

        return {
            systemPrompt: event.systemPrompt + "\n\n" + cachedAppendix,
        };
    });
}
