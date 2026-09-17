import assert from "node:assert/strict";
import test, { describe } from "node:test";
import {
	SkillCatalog,
	stripFrontmatter,
	type CatalogSkill,
} from "../src/skill-catalog.ts";

describe("stripFrontmatter", () => {
	test("strips standard YAML frontmatter with LF newlines", () => {
		const raw = "---\nname: test\ndescription: desc\n---\n# Main Title\n\nBody content.";
		const result = stripFrontmatter(raw);
		assert.equal(result, "# Main Title\n\nBody content.");
	});

	test("strips YAML frontmatter with CRLF newlines", () => {
		const raw = "---\r\nname: test\r\ndescription: desc\r\n---\r\n# Main Title\r\n\r\nBody content.";
		const result = stripFrontmatter(raw);
		assert.equal(result, "# Main Title\n\nBody content.");
	});

	test("returns content unchanged when no frontmatter is present", () => {
		const raw = "# Just Markdown\n\nNo frontmatter here.";
		const result = stripFrontmatter(raw);
		assert.equal(result, "# Just Markdown\n\nNo frontmatter here.");
	});

	test("returns null when body is empty", () => {
		const raw = "---\nname: test\n---\n   \n\n  ";
		const result = stripFrontmatter(raw);
		assert.equal(result, null);
	});
});

describe("SkillCatalog", () => {
	const sampleSkills: CatalogSkill[] = [
		{
			name: "code-review",
			filePath: "/path/to/code-review/SKILL.md",
			baseDir: "/path/to/code-review",
			disableModelInvocation: false,
		},
		{
			name: "grill-me",
			filePath: "/path/to/grill-me/SKILL.md",
			baseDir: "/path/to/grill-me",
			disableModelInvocation: true,
		},
		{
			name: "tdd",
			filePath: "/path/to/tdd/SKILL.md",
			baseDir: "/path/to/tdd",
			disableModelInvocation: false,
		},
	];

	test("resolves physical skill with exact name and baseDir prefix", () => {
		const files: Record<string, string> = {
			"/path/to/code-review/SKILL.md": "# Code Review Instructions",
		};
		const catalog = new SkillCatalog({
			readFile: (path) => files[path] ?? null,
		});
		catalog.update({ skills: sampleSkills });

		const result = catalog.resolve("code-review");

		assert.equal(result.ok, true);
		if (result.ok && result.kind === "physical") {
			assert.equal(result.name, "code-review");
			assert.equal(result.baseDir, "/path/to/code-review");
			assert.equal(
				result.content,
				"Base directory: /path/to/code-review\n\n# Code Review Instructions",
			);
		}
	});

	test("resolves physical skill with case-insensitive fallback (e.g. TDD)", () => {
		const files: Record<string, string> = {
			"/path/to/tdd/SKILL.md": "# TDD Workflow",
		};
		const catalog = new SkillCatalog({
			readFile: (path) => files[path] ?? null,
		});
		catalog.update({ skills: sampleSkills });

		const result = catalog.resolve("TDD");

		assert.equal(result.ok, true);
		if (result.ok && result.kind === "physical") {
			assert.equal(result.name, "tdd");
			assert.ok(result.content.includes("# TDD Workflow"));
		}
	});

	test("resolves virtual skill pi-docs from memory", () => {
		const catalog = new SkillCatalog({
			readFile: () => {
				throw new Error("Should not touch files for virtual skill");
			},
		});
		catalog.update({
			skills: sampleSkills,
			capturedDocs: "Pi documentation guide...",
		});

		const result = catalog.resolve("pi-docs");

		assert.equal(result.ok, true);
		if (result.ok && result.kind === "virtual") {
			assert.equal(result.name, "pi-docs");
			assert.equal(result.content, "Pi documentation guide...");
		}
	});

	test("returns not-found when pi-docs is requested but no docs were captured", () => {
		const catalog = new SkillCatalog();
		catalog.update({ skills: sampleSkills, capturedDocs: null });

		const result = catalog.resolve("pi-docs");

		assert.equal(result.ok, false);
		if (!result.ok) {
			assert.equal(result.error, "not-found");
			assert.ok(result.message.includes('Skill "pi-docs" is not available'));
		}
	});

	test("returns no-skills when catalog has no skills", () => {
		const catalog = new SkillCatalog();
		catalog.update({ skills: [] });

		const result = catalog.resolve("any-skill");

		assert.equal(result.ok, false);
		if (!result.ok) {
			assert.equal(result.error, "no-skills");
		}
	});

	test("withholds hidden skills from available list on failure (prevents leakage)", () => {
		const catalog = new SkillCatalog();
		catalog.update({
			skills: sampleSkills,
			capturedDocs: "Docs content",
		});

		const result = catalog.resolve("non-existent");

		assert.equal(result.ok, false);
		if (!result.ok && result.error === "not-found") {
			// grill-me has disableModelInvocation: true, so it MUST NOT be in available
			assert.deepEqual(result.available, ["code-review", "tdd", "pi-docs"]);
			assert.ok(!result.available.includes("grill-me"));
			assert.ok(result.message.includes("code-review, tdd, pi-docs"));
			assert.ok(!result.message.includes("grill-me"));
		}
	});

	test("blocks model invocation for hidden skills (user-only)", () => {
		const catalog = new SkillCatalog({ allowUserOnly: false });
		catalog.update({ skills: sampleSkills });

		const result = catalog.resolve("grill-me");

		assert.equal(result.ok, false);
		if (!result.ok && result.error === "user-only") {
			assert.equal(result.skillName, "grill-me");
			assert.ok(result.message.includes("user-invocable only"));
			assert.ok(result.message.includes("Ask the user to run /skill:grill-me."));
		}
	});

	test("allows hidden skills when allowUserOnly is explicitly enabled", () => {
		const files: Record<string, string> = {
			"/path/to/grill-me/SKILL.md": "# Grill Me Content",
		};
		const catalog = new SkillCatalog({
			allowUserOnly: true,
			readFile: (path) => files[path] ?? null,
		});
		catalog.update({ skills: sampleSkills });

		const result = catalog.resolve("grill-me");

		assert.equal(result.ok, true);
		if (result.ok && result.kind === "physical") {
			assert.equal(result.name, "grill-me");
		}
	});

	test("returns empty-body when file cannot be read or body is empty", () => {
		const catalog = new SkillCatalog({
			readFile: () => null,
		});
		catalog.update({ skills: sampleSkills });

		const result = catalog.resolve("code-review");

		assert.equal(result.ok, false);
		if (!result.ok && result.error === "empty-body") {
			assert.equal(result.skillName, "code-review");
			assert.ok(result.message.includes("empty or unreadable body"));
		}
	});
});
