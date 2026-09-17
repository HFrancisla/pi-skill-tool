/**
 * prompt-transformer — 提示词转换管线（深模块）
 *
 * 封装所有系统提示词的纯文本重构逻辑：
 * 1. 剥离常驻的 Pi documentation 段落，下沉为内存虚拟技能 pi-docs。
 * 2. 将加载指令由基于文件的原生指令（read/bash）重写为按名称加载（skill）。
 * 3. 移除相对路径解析规则（PATH_RULE）。
 * 4. 移除模型可见技能的所有 <location> 行（防绕过与提示词瘦身）。
 * 5. 将虚拟技能 pi-docs 注入 <available_skills> 列表尾部。
 */

/** pi 生成的原生加载指令 —— 二选一 (read 或 bash)，取决于当前激活的工具 */
export const NATIVE_INSTRUCTIONS = [
	"Use the read tool to load a skill's file when the task matches its description.",
	"Use bash to load a skill's file when the task matches its description.",
] as const;

/** 替换目标：指向 skill 工具 */
export const SKILL_INSTRUCTION =
	"Use the skill tool to load a skill by name when the task matches its description.";

/** pi 的相对路径解析规则（名称加载模式下多余，由工具直接返回 Base directory） */
export const PATH_RULE =
	"When a skill file references a relative path, resolve it against the skill directory (parent of SKILL.md / dirname of the path) and use that absolute path in tool commands.\n";

/** 内置虚拟技能名：Pi 文档导航 */
export const PI_DOCS_NAME = "pi-docs";

/** 虚拟技能描述：精准触发针对 pi 自身的二次开发指导 */
export const PI_DOCS_DESC =
	"Read documentation and development guides for pi itself, its SDK, extensions, themes, skills, and TUI.";

/** 匹配并捕获原有的 Pi documentation 文本块 */
export const PI_DOCS_BLOCK_REGEX =
	/\n\nPi documentation \(read only when the user asks about pi itself[\s\S]*?\(e\.g\., tui\.md for TUI API details\)/;

/**
 * 技能结构接口（自包含定义，不依赖任何外部 SDK）
 */
export interface PromptSkill {
	name: string;
	filePath: string;
	disableModelInvocation?: boolean;
}

export type TransformWarningCode =
	| "docs-block-not-found"
	| "instruction-not-found"
	| "locations-not-found";

export interface TransformWarning {
	code: TransformWarningCode;
	message: string;
}

export interface TransformInput {
	prompt: string;
	skills?: PromptSkill[];
	existingCapturedDocs?: string | null;
}

export interface TransformResult {
	prompt: string;
	capturedDocs: string | null;
	warnings: TransformWarning[];
	modified: boolean;
}

/**
 * 转义 XML 特殊字符，与 pi 内部 escapeXml 保持完全一致
 */
export function escapeXml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;");
}

/** <location> 行在提示里的确切形态 (4 空格缩进 + 尾随换行) */
export function locationLine(filePath: string): string {
	return `    <location>${escapeXml(filePath)}</location>\n`;
}

/**
 * 执行系统提示词转换管线（纯函数，零副作用）
 */
export function transformPrompt(input: TransformInput): TransformResult {
	let prompt = input.prompt;
	let modified = false;
	const warnings: TransformWarning[] = [];
	let capturedDocs = input.existingCapturedDocs ?? null;

	// ① 剥离并捕获常驻的 Pi documentation 段落
	const docsMatch = prompt.match(PI_DOCS_BLOCK_REGEX);
	if (docsMatch) {
		capturedDocs = docsMatch[0].trim();
		prompt = prompt.replace(docsMatch[0], "");
		modified = true;
	} else if (prompt.includes("Available tools:")) {
		warnings.push({
			code: "docs-block-not-found",
			message:
				"未在系统提示中找到 Pi documentation 段落(pi 的措辞可能已变更);已保留它,未注册虚拟技能 pi-docs。",
		});
	}

	// pi 只在存在"模型可见"的 skill 时才生成那块提示
	const shown = (input.skills ?? []).filter((s) => !s.disableModelInvocation);
	if (shown.length > 0) {
		const native = NATIVE_INSTRUCTIONS.find((line) => prompt.includes(line));
		if (!native) {
			// pi 换了措辞。不改提示(保持可用),只返回诊断警告
			warnings.push({
				code: "instruction-not-found",
				message:
					"pi 的 skill 加载指令未在系统提示中找到(措辞可能已变更);已保持提示原样,skill 工具仍可用。",
			});
		} else {
			// ① 加载指令: read/bash → skill
			prompt = prompt.replace(native, SKILL_INSTRUCTION);

			// ② 删掉相对路径解析规则
			prompt = prompt.replace(PATH_RULE, "");

			// ③ 删掉每条 <location>
			let removed = 0;
			for (const skill of shown) {
				const line = locationLine(skill.filePath);
				if (prompt.includes(line)) {
					prompt = prompt.replace(line, "");
					removed += 1;
				}
			}
			if (removed === 0) {
				warnings.push({
					code: "locations-not-found",
					message:
						"未在系统提示中找到任何 <location> 行(pi 的输出格式可能已变更);已保留它们。",
				});
			}

			// ④ 在 <available_skills> 列表中追加注入 pi-docs 虚拟条目
			if (
				capturedDocs &&
				prompt.includes("</available_skills>") &&
				!prompt.includes(`<name>${PI_DOCS_NAME}</name>`)
			) {
				const virtualEntry = `  <skill>\n    <name>${PI_DOCS_NAME}</name>\n    <description>${PI_DOCS_DESC}</description>\n  </skill>\n</available_skills>`;
				prompt = prompt.replace("</available_skills>", virtualEntry);
			}
			modified = true;
		}
	}

	return {
		prompt,
		capturedDocs,
		warnings,
		modified,
	};
}
