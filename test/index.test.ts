import { describe, it, expect } from "vitest";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

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

describe("parseFrontmatter", () => {
    it("parses valid frontmatter", () => {
        const content = [
            "---",
            "name: architecture",
            "description: Key architectural decisions and patterns",
            "---",
            "",
            "# Architecture",
            "",
            "Some content here.",
        ].join("\n");

        const result = parseFrontmatter(content, "architecture.md");
        expect(result).toEqual({
            name: "architecture",
            description: "Key architectural decisions and patterns",
        });
    });

    it("throws when frontmatter is missing", () => {
        const content = "# Just a regular markdown file\n\nNo frontmatter here.";
        expect(() => parseFrontmatter(content, "notes.md")).toThrow(FrontmatterParseError);
        expect(() => parseFrontmatter(content, "notes.md")).toThrow("notes.md: missing YAML frontmatter delimiters");
    });

    it("throws when name is missing", () => {
        const content = ["---", "description: Some description", "---", "", "Content"].join("\n");
        expect(() => parseFrontmatter(content, "bad.md")).toThrow("bad.md: missing required `name` field");
    });

    it("throws when description is missing", () => {
        const content = ["---", "name: test", "---", "", "Content"].join("\n");
        expect(() => parseFrontmatter(content, "bad.md")).toThrow("bad.md: missing required `description` field");
    });

    it("handles CRLF line endings", () => {
        const content = ["---", "name: test", "description: A test memory", "---", "", "Content"].join("\r\n");

        const result = parseFrontmatter(content, "test.md");
        expect(result).toEqual({
            name: "test",
            description: "A test memory",
        });
    });

    it("handles extra whitespace in field values", () => {
        const content = ["---", "name:   my-memory  ", "description:   Some desc   ", "---"].join("\n");

        const result = parseFrontmatter(content, "ws.md");
        expect(result).toEqual({
            name: "my-memory",
            description: "Some desc",
        });
    });

    it("throws when delimiters are not at the start", () => {
        const content = ["Some text before", "---", "name: test", "description: desc", "---"].join("\n");
        expect(() => parseFrontmatter(content, "bad.md")).toThrow(FrontmatterParseError);
    });

    it("handles hyphenated names", () => {
        const content = ["---", "name: my-cool-memory", "description: A hyphenated name", "---"].join("\n");

        const result = parseFrontmatter(content, "my-cool-memory.md");
        expect(result?.name).toBe("my-cool-memory");
    });

    it("includes file path in error message", () => {
        expect(() => parseFrontmatter("no frontmatter", "/path/to/my-file.md")).toThrow(
            "/path/to/my-file.md: missing YAML frontmatter delimiters",
        );
    });
});

describe("scanMemories (integration)", () => {
    it("collects both memories and parse errors", async () => {
        const dir = join(tmpdir(), `pi-memory-test-${Date.now()}`);
        await mkdir(dir, { recursive: true });

        try {
            await writeFile(
                join(dir, "architecture.md"),
                ["---", "name: architecture", "description: Architecture decisions", "---", "", "# Architecture"].join(
                    "\n",
                ),
            );

            await writeFile(
                join(dir, "conventions.md"),
                ["---", "name: conventions", "description: Code conventions", "---", "", "# Conventions"].join("\n"),
            );

            // Invalid: no frontmatter
            await writeFile(join(dir, "notes.md"), "# Just notes\n\nNo frontmatter.");

            // Invalid: missing description
            await writeFile(join(dir, "incomplete.md"), ["---", "name: incomplete", "---"].join("\n"));

            const { readdir, readFile } = await import("node:fs/promises");
            const { existsSync } = await import("node:fs");

            const scanDir = async (d: string) => {
                if (!existsSync(d)) return { memories: [] as MemoryMeta[], errors: [] as FrontmatterParseError[] };
                const entries = await readdir(d);
                const memories: MemoryMeta[] = [];
                const errors: FrontmatterParseError[] = [];
                for (const entry of entries) {
                    if (!entry.endsWith(".md")) continue;
                    const filePath = join(d, entry);
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
            };

            const result = await scanDir(dir);

            expect(result.memories).toHaveLength(2);
            expect(result.memories.map((m) => m.name).sort()).toEqual(["architecture", "conventions"]);

            expect(result.errors).toHaveLength(2);
            const errorFiles = result.errors.map((e) => e.filePath);
            expect(errorFiles).toContain(join(dir, "notes.md"));
            expect(errorFiles).toContain(join(dir, "incomplete.md"));
        } finally {
            await rm(dir, { recursive: true });
        }
    });
});
