/**
 * skill-catalog — 技能目录与解析引擎（深模块）
 *
 * 封装技能的注册索引、名称检索、大小写容错、权限判定、虚拟技能拦截与文件正文读取。
 */

import { readFileSync } from "node:fs";
import { PI_DOCS_NAME } from "./prompt-transformer.ts";

export interface CatalogSkill {
	name: string;
	filePath: string;
	baseDir: string;
	sourceInfo?: unknown;
	disableModelInvocation: boolean;
}

export type SkillResolveResult =
	| {
			ok: true;
			kind: "physical";
			name: string;
			content: string;
			filePath: string;
			baseDir: string;
			sourceInfo?: unknown;
	  }
	| {
			ok: true;
			kind: "virtual";
			name: string;
			content: string;
	  }
	| {
			ok: false;
			error: "not-found";
			requestedName: string;
			available: string[];
			message: string;
	  }
	| {
			ok: false;
			error: "user-only";
			skillName: string;
			message: string;
	  }
	| {
			ok: false;
			error: "empty-body";
			skillName: string;
			filePath: string;
			message: string;
	  }
	| {
			ok: false;
			error: "no-skills";
			message: string;
	  };

export type FileReader = (filePath: string) => string | null;

export interface SkillCatalogOptions {
	allowUserOnly?: boolean;
	readFile?: FileReader;
}

/**
 * 剥离 Markdown 文件的 YAML frontmatter 并返回有效正文。
 * 纯字符串操作，零外部依赖。
 */
export function stripFrontmatter(content: string): string | null {
	const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
	let body: string;
	if (!normalized.startsWith("---")) {
		body = normalized;
	} else {
		const endIndex = normalized.indexOf("\n---", 3);
		if (endIndex === -1) {
			body = normalized;
		} else {
			body = normalized.slice(endIndex + 4);
		}
	}
	const trimmed = body.trim();
	return trimmed.length > 0 ? trimmed : null;
}

export function defaultFileReader(filePath: string): string | null {
	try {
		const raw = readFileSync(filePath, "utf8");
		return stripFrontmatter(raw);
	} catch {
		return null;
	}
}

export class SkillCatalog {
	private skills: CatalogSkill[] = [];
	private capturedPiDocs: string | null = null;
	private readonly allowUserOnly: boolean;
	private readonly readFile: FileReader;

	constructor(options?: SkillCatalogOptions) {
		this.allowUserOnly = options?.allowUserOnly ?? false;
		this.readFile = options?.readFile ?? defaultFileReader;
	}

	/**
	 * 更新当前会话的技能列表或捕获的虚拟文档
	 */
	update(state: { skills?: CatalogSkill[]; capturedDocs?: string | null }): void {
		if (state.skills && state.skills.length > 0) {
			this.skills = state.skills;
		}
		if (state.capturedDocs !== undefined) {
			this.capturedPiDocs = state.capturedDocs;
		}
	}

	getCapturedDocs(): string | null {
		return this.capturedPiDocs;
	}

	getSkills(): CatalogSkill[] {
		return this.skills;
	}

	getVisibleSkills(): CatalogSkill[] {
		return this.skills.filter((s) => !s.disableModelInvocation);
	}

	getCallableSkills(): CatalogSkill[] {
		return this.allowUserOnly ? this.skills : this.getVisibleSkills();
	}

	/**
	 * 当前会话可被模型调用的有效技能名称列表（失败提示与校验兜底）
	 */
	getCallableNames(): string[] {
		const list = this.getCallableSkills().map((s) => s.name);
		if (this.capturedPiDocs && !list.includes(PI_DOCS_NAME)) {
			list.push(PI_DOCS_NAME);
		}
		return list;
	}

	/**
	 * 解析并加载技能正文
	 */
	resolve(rawRequestedName: string): SkillResolveResult {
		const rawName = String(rawRequestedName ?? "").trim();
		const name = rawName.toLowerCase();

		// 1. 拦截虚拟技能 pi-docs
		if (name === PI_DOCS_NAME) {
			if (!this.capturedPiDocs) {
				return {
					ok: false,
					error: "not-found",
					requestedName: rawName,
					available: this.getCallableNames(),
					message: `Skill "${PI_DOCS_NAME}" is not available in this session.`,
				};
			}
			return {
				ok: true,
				kind: "virtual",
				name: PI_DOCS_NAME,
				content: this.capturedPiDocs,
			};
		}

		// 2. 会话中无技能
		if (this.skills.length === 0) {
			return {
				ok: false,
				error: "no-skills",
				message: "No skills are loaded in this session.",
			};
		}

		// 3. 查找技能（精确匹配优先，小写归一化兜底）
		const skill =
			this.skills.find((s) => s.name === rawName) ??
			this.skills.find((s) => s.name.toLowerCase() === name);

		if (!skill) {
			return {
				ok: false,
				error: "not-found",
				requestedName: rawName,
				available: this.getCallableNames(),
				message:
					`No skill named "${rawName}". ` +
					`Available: ${this.getCallableNames().join(", ") || "(none)"}`,
			};
		}

		// 4. 隐藏技能权限检查
		if (skill.disableModelInvocation && !this.allowUserOnly) {
			return {
				ok: false,
				error: "user-only",
				skillName: skill.name,
				message:
					`Skill "${name}" is user-invocable only ` +
					`(disable-model-invocation: true). ` +
					`Ask the user to run /skill:${name}.`,
			};
		}

		// 5. 正文读取与前置 YAML 剥离
		const body = this.readFile(skill.filePath);
		if (body === null) {
			return {
				ok: false,
				error: "empty-body",
				skillName: skill.name,
				filePath: skill.filePath,
				message: `Skill "${name}" has an empty or unreadable body (${skill.filePath}).`,
			};
		}

		// 6. 成功加载物理技能，附带 Base directory 前缀
		return {
			ok: true,
			kind: "physical",
			name: skill.name,
			content: `Base directory: ${skill.baseDir}\n\n${body}`,
			filePath: skill.filePath,
			baseDir: skill.baseDir,
			sourceInfo: skill.sourceInfo,
		};
	}
}
