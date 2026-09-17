import assert from "node:assert/strict";
import test, { describe } from "node:test";
import {
	escapeXml,
	locationLine,
	NATIVE_INSTRUCTIONS,
	PATH_RULE,
	PI_DOCS_DESC,
	PI_DOCS_NAME,
	SKILL_INSTRUCTION,
	transformPrompt,
	type PromptSkill,
} from "../src/prompt-transformer.ts";

const SAMPLE_DOCS_BLOCK = `\n\nPi documentation (read only when the user asks about pi itself, its SDK, extensions, themes, skills, and TUI):
- Main documentation: /path/to/pi/README.md
- Additional docs: /path/to/pi/docs (e.g., tui.md for TUI API details)`;

function buildSamplePrompt(options: {
	includeDocs?: boolean;
	instruction?: string;
	includePathRule?: boolean;
	skills?: { name: string; location: string }[];
	includeToolsMarker?: boolean;
	alreadyHasPiDocs?: boolean;
}) {
	let prompt = "";
	if (options.includeToolsMarker ?? true) {
		prompt += "Available tools:\n- read: Read a file\n\nGuidelines:\n- Follow instructions.\n";
	}

	if (options.includeDocs ?? true) {
		prompt += SAMPLE_DOCS_BLOCK;
	}

	prompt += "\n\nThe following skills provide specialized instructions for specific tasks.\n";

	if (options.instruction) {
		prompt += `${options.instruction}\n`;
	}

	if (options.includePathRule ?? true) {
		prompt += PATH_RULE;
	}

	prompt += "\n<available_skills>\n";
	for (const s of options.skills ?? []) {
		prompt += `  <skill>\n    <name>${s.name}</name>\n    <description>Description for ${s.name}</description>\n    <location>${escapeXml(s.location)}</location>\n  </skill>\n`;
	}
	if (options.alreadyHasPiDocs) {
		prompt += `  <skill>\n    <name>${PI_DOCS_NAME}</name>\n    <description>${PI_DOCS_DESC}</description>\n  </skill>\n`;
	}
	prompt += "</available_skills>";

	return prompt;
}

describe("PromptTransformer", () => {
	test("transforms standard prompt with read instruction and physical skills", () => {
		const skills: PromptSkill[] = [
			{ name: "code-review", filePath: "/home/user/.pi/skills/code-review/SKILL.md" },
			{ name: "tdd", filePath: "/home/user/.pi/skills/tdd/SKILL.md" },
		];

		const inputPrompt = buildSamplePrompt({
			includeDocs: true,
			instruction: NATIVE_INSTRUCTIONS[0],
			includePathRule: true,
			skills: [
				{ name: "code-review", location: "/home/user/.pi/skills/code-review/SKILL.md" },
				{ name: "tdd", location: "/home/user/.pi/skills/tdd/SKILL.md" },
			],
		});

		const result = transformPrompt({ prompt: inputPrompt, skills });

		assert.equal(result.modified, true);
		assert.equal(result.warnings.length, 0);
		assert.ok(result.capturedDocs?.includes("Pi documentation (read only when the user asks"));
		assert.ok(!result.prompt.includes("Pi documentation (read only when the user asks"));
		assert.ok(result.prompt.includes(SKILL_INSTRUCTION));
		assert.ok(!result.prompt.includes(NATIVE_INSTRUCTIONS[0]));
		assert.ok(!result.prompt.includes(PATH_RULE));
		assert.ok(!result.prompt.includes("<location>"));
		assert.ok(result.prompt.includes(`<name>${PI_DOCS_NAME}</name>`));
		assert.ok(result.prompt.includes(`<description>${PI_DOCS_DESC}</description>`));
	});

	test("handles bash instruction variant", () => {
		const skills: PromptSkill[] = [
			{ name: "code-review", filePath: "/home/user/.pi/skills/code-review/SKILL.md" },
		];

		const inputPrompt = buildSamplePrompt({
			includeDocs: true,
			instruction: NATIVE_INSTRUCTIONS[1],
			skills: [{ name: "code-review", location: "/home/user/.pi/skills/code-review/SKILL.md" }],
		});

		const result = transformPrompt({ prompt: inputPrompt, skills });

		assert.equal(result.modified, true);
		assert.ok(result.prompt.includes(SKILL_INSTRUCTION));
		assert.ok(!result.prompt.includes(NATIVE_INSTRUCTIONS[1]));
	});

	test("ignores hidden skills marked with disableModelInvocation: true", () => {
		const skills: PromptSkill[] = [
			{ name: "visible-one", filePath: "/path/visible/SKILL.md" },
			{ name: "hidden-one", filePath: "/path/hidden/SKILL.md", disableModelInvocation: true },
		];

		const inputPrompt = buildSamplePrompt({
			includeDocs: true,
			instruction: NATIVE_INSTRUCTIONS[0],
			skills: [
				{ name: "visible-one", location: "/path/visible/SKILL.md" },
				// pi's formatSkillsForPrompt does not render hidden skills in prompt
			],
		});

		const result = transformPrompt({ prompt: inputPrompt, skills });

		assert.equal(result.modified, true);
		assert.equal(result.warnings.length, 0);
		assert.ok(!result.prompt.includes("/path/visible/SKILL.md"));
		assert.ok(!result.prompt.includes("<location>"));
	});

	test("does not process skill block if all skills are hidden or empty", () => {
		const skills: PromptSkill[] = [
			{ name: "hidden-only", filePath: "/path/hidden/SKILL.md", disableModelInvocation: true },
		];

		const inputPrompt = buildSamplePrompt({
			includeDocs: true,
			instruction: undefined,
			includePathRule: false,
			skills: [],
		});

		const result = transformPrompt({ prompt: inputPrompt, skills });

		assert.equal(result.modified, true);
		assert.equal(result.warnings.length, 0);
		assert.ok(result.capturedDocs !== null);
		assert.ok(!result.prompt.includes("Pi documentation"));
	});

	test("warns when docs block is missing in default template", () => {
		const skills: PromptSkill[] = [
			{ name: "code-review", filePath: "/home/user/.pi/skills/code-review/SKILL.md" },
		];

		const inputPrompt = buildSamplePrompt({
			includeDocs: false,
			instruction: NATIVE_INSTRUCTIONS[0],
			skills: [{ name: "code-review", location: "/home/user/.pi/skills/code-review/SKILL.md" }],
		});

		const result = transformPrompt({ prompt: inputPrompt, skills });

		assert.equal(result.modified, true);
		assert.ok(result.warnings.some((w) => w.code === "docs-block-not-found"));
		assert.equal(result.capturedDocs, null);
		assert.ok(!result.prompt.includes(`<name>${PI_DOCS_NAME}</name>`));
	});

	test("warns when native instruction is not found and leaves prompt unmodified", () => {
		const skills: PromptSkill[] = [
			{ name: "code-review", filePath: "/home/user/.pi/skills/code-review/SKILL.md" },
		];

		const inputPrompt = buildSamplePrompt({
			includeDocs: true,
			instruction: "Use some completely unrecognized instruction.",
			skills: [{ name: "code-review", location: "/home/user/.pi/skills/code-review/SKILL.md" }],
		});

		const result = transformPrompt({ prompt: inputPrompt, skills });

		assert.ok(result.warnings.some((w) => w.code === "instruction-not-found"));
		assert.ok(result.prompt.includes("Use some completely unrecognized instruction."));
		assert.ok(result.prompt.includes("<location>"));
	});

	test("warns when location lines cannot be matched", () => {
		const skills: PromptSkill[] = [
			{ name: "code-review", filePath: "/home/user/.pi/skills/code-review/SKILL.md" },
		];

		// Prompt has skills block but no <location> line
		let inputPrompt = buildSamplePrompt({
			includeDocs: true,
			instruction: NATIVE_INSTRUCTIONS[0],
			skills: [],
		});
		inputPrompt = inputPrompt.replace(
			"</available_skills>",
			"  <skill>\n    <name>code-review</name>\n    <description>desc</description>\n  </skill>\n</available_skills>",
		);

		const result = transformPrompt({ prompt: inputPrompt, skills });

		assert.ok(result.warnings.some((w) => w.code === "locations-not-found"));
	});

	test("correctly escapes XML characters in skill locations", () => {
		const specialPath = '/path/with/&/<_">/\'quotes\'/SKILL.md';
		const skills: PromptSkill[] = [{ name: "special", filePath: specialPath }];

		const inputPrompt = buildSamplePrompt({
			includeDocs: true,
			instruction: NATIVE_INSTRUCTIONS[0],
			skills: [{ name: "special", location: specialPath }],
		});

		assert.ok(inputPrompt.includes(locationLine(specialPath)));

		const result = transformPrompt({ prompt: inputPrompt, skills });

		assert.equal(result.warnings.length, 0);
		assert.ok(!result.prompt.includes(escapeXml(specialPath)));
		assert.ok(!result.prompt.includes("<location>"));
	});

	test("reuses existingCapturedDocs when docs block was previously stripped", () => {
		const skills: PromptSkill[] = [
			{ name: "code-review", filePath: "/home/user/.pi/skills/code-review/SKILL.md" },
		];

		const inputPrompt = buildSamplePrompt({
			includeDocs: false,
			includeToolsMarker: false,
			instruction: NATIVE_INSTRUCTIONS[0],
			skills: [{ name: "code-review", location: "/home/user/.pi/skills/code-review/SKILL.md" }],
		});

		const result = transformPrompt({
			prompt: inputPrompt,
			skills,
			existingCapturedDocs: "Previously captured Pi documentation...",
		});

		assert.equal(result.capturedDocs, "Previously captured Pi documentation...");
		assert.ok(result.prompt.includes(`<name>${PI_DOCS_NAME}</name>`));
	});

	test("does not inject pi-docs twice if already present", () => {
		const skills: PromptSkill[] = [
			{ name: "code-review", filePath: "/home/user/.pi/skills/code-review/SKILL.md" },
		];

		const inputPrompt = buildSamplePrompt({
			includeDocs: true,
			instruction: NATIVE_INSTRUCTIONS[0],
			skills: [{ name: "code-review", location: "/home/user/.pi/skills/code-review/SKILL.md" }],
			alreadyHasPiDocs: true,
		});

		const result = transformPrompt({ prompt: inputPrompt, skills });

		const matches = result.prompt.match(new RegExp(`<name>${PI_DOCS_NAME}</name>`, "g"));
		assert.equal(matches?.length, 1);
	});
});
