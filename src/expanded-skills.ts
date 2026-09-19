const EXPANDED_SKILL_BLOCK = /<skill\b(?=[^>]*\bname="([^"]+)")[^>]*>[\s\S]*?<\/skill>/gu;

/**
 * Return skill names that Pi has expanded into a user prompt.
 *
 * The native command form is an attribute-based block (`<skill name="...">`),
 * which is distinct from the `<skill><name>...</name>` entries in the
 * available-skills system-prompt section.
 */
export function extractExpandedSkillNames(text: string): Set<string> {
	const names = new Set<string>();

	for (const match of text.matchAll(EXPANDED_SKILL_BLOCK)) {
		const name = match[1]?.trim().toLowerCase();
		if (name) names.add(name);
	}

	return names;
}
