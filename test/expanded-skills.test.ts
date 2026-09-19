import assert from "node:assert/strict";
import test, { describe } from "node:test";
import { extractExpandedSkillNames } from "../src/expanded-skills.ts";

describe("extractExpandedSkillNames", () => {
	test("finds Pi-native expanded skill blocks", () => {
		const names = extractExpandedSkillNames(
			'<skill name="grill-with-docs" location="/skills/grill-with-docs/SKILL.md">\n' +
			"Call the Skill tool twice.\n" +
			"</skill>",
		);

		assert.deepEqual([...names], ["grill-with-docs"]);
	});

	test("finds multiple blocks and normalizes names", () => {
		const names = extractExpandedSkillNames(
			'<skill location="/skills/a/SKILL.md" name="Grilling">A</skill>\n' +
			'<skill name="domain-modeling" location="/skills/b/SKILL.md">B</skill>\n' +
			'<skill name="GRILLING" location="/skills/a/SKILL.md">A</skill>',
		);

		assert.deepEqual([...names], ["grilling", "domain-modeling"]);
	});

	test("does not treat available-skills entries as expanded blocks", () => {
		const names = extractExpandedSkillNames(
			"<available_skills>\n" +
			"  <skill>\n" +
			"    <name>grilling</name>\n" +
			"    <description>desc</description>\n" +
			"  </skill>\n" +
			"</available_skills>",
		);

		assert.deepEqual([...names], []);
	});

	test("returns no names for ordinary user text", () => {
		assert.deepEqual([...extractExpandedSkillNames("Please review this plan.")], []);
	});
});
