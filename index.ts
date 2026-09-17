/**
 * skill-tool — Claude Code 风格的 `skill` 工具,并让 pi 的 skill 块与"按名称加载"自洽。
 *
 * ── 它做什么 ─────────────────────────────────────────────────────────────
 * 两件事:
 *
 *   1. 注册一个 `skill` 工具:按精确名字加载 skill 的正文。
 *   2. 把系统提示里的 skill 块改造成**纯名称制** ——
 *        · 加载指令:  原「用 `read` 加载那个文件」→「用 `skill` 按名字加载」
 *        · 相对路径规则:删除(名称加载下工具直接返回 base directory,不需要规则)
 *        · 每条 <location>:删除(模型不再按路径加载,留着是绕过工具的入口)
 *
 * **skill 的 name 与 description 一字不动。** 删掉的只有路径 —— 而路径在名称
 * 加载模式下是冗余信息。实测:整个块 -24%,且零保真度损失。
 *
 * ── 为什么 ───────────────────────────────────────────────────────────────
 * 为 Claude Code 写的 skill 里有这种句子:
 *
 *     Call the Skill tool with "grilling".
 *
 * CC 自己的提示词是"The following skills are available for use with the Skill tool:"
 * —— 目录在提示里,`Skill` 工具负责执行。原版 pi 用 `read` 加载、没有这个工具,
 * 于是那句话是死指令(pi 不校验 skill 正文,静默失效、不报错)。
 *
 * 本扩展把工具补上,**并把整个块改成名称制**,从而:
 *   · 只有一条加载路径,一个标识符空间(名称),不再出现"指令说名称、数据给路径"的割裂
 *   · skill 之间互相委派("Call the Skill tool with X")可执行
 *   · 目录的 name/description 保真度零损失,同时省下约 24% 的块体积
 *
 * ── 设计取舍:为什么不省更多 ──────────────────────────────────────────────
 * @arhen/pi-core-skill-tool 靠**把描述截断到 100 字符**省 ~4.5K token;
 * @valdo766hi/pi-lazy-skill-tool 靠**只展示短名单 + 分页搜索**省。
 * 本扩展一个都不做:描述完整保留,只删掉名称加载下不再需要的路径。
 * 省得少,但没有保真度代价,也没有额外的发现步骤。
 *
 * ── 兜底 ─────────────────────────────────────────────────────────────────
 * 删掉 <location> 后,模型不能再绕过工具直接 `read` skill 文件 —— 这正是目的。
 * 但 `/skill:name` 命令不受影响:它走 pi 的命令注册表(getSkills + getCommands),
 * 与系统提示无关。所以工具出问题时,你仍能手动调用任何一个 skill。
 */

import {
	parseFrontmatter,
	type ExtensionAPI,
	type ExtensionContext,
	type SourceInfo,
} from "@earendil-works/pi-coding-agent";
import { readFileSync } from "node:fs";
import { Type } from "typebox";

/** 小写以符合 pi 的内置工具惯例。 */
const TOOL_NAME = "skill";

/** true 则连 disable-model-invocation 的 skill 也允许模型加载（会绕过 skill 作者的手动触发设计，慎用）。 */
const ALLOW_USER_ONLY = false;

/**
 * pi 生成的原生加载指令 —— 二选一(read 或 bash),取决于当前激活的工具。
 * 见 pi 的 formatSkillsForPrompt():
 *   fileReadTool === "read" ? "Use the read tool ..." : "Use bash ..."
 */
const NATIVE_INSTRUCTIONS = [
	"Use the read tool to load a skill's file when the task matches its description.",
	"Use bash to load a skill's file when the task matches its description.",
] as const;

/** 替换目标:指向本工具。措辞尽量贴着原生那句,便于模型迁移。 */
const SKILL_INSTRUCTION =
	"Use the skill tool to load a skill by name when the task matches its description.";

/**
 * pi 的"相对路径解析"规则 —— 路径加载模式的补丁。
 *
 * 原意:模型用 `read` 读到一个 SKILL.md 后,正文里若有 `references/x.md` 这类相对
 * 引用,模型得自己算出"那个文件在哪个目录"才能解析。
 *
 * 名称加载下这条规则不再需要:工具在返回正文时已经直接给出 `Base directory: <绝对路径>`
 * —— 给的是**结果**,不是让模型去推导的**规则**。
 */
const PATH_RULE =
	"When a skill file references a relative path, resolve it against the skill directory (parent of SKILL.md / dirname of the path) and use that absolute path in tool commands.\n";

/** 内置虚拟技能名：Pi 文档导航 */
const PI_DOCS_NAME = "pi-docs";

/** 虚拟技能描述：精准触发针对 pi 自身的二次开发指导 */
const PI_DOCS_DESC =
	"Read documentation and development guides for pi itself, its SDK, extensions, themes, skills, and TUI.";

/** 匹配并捕获原有的 Pi documentation 文本块 */
const PI_DOCS_BLOCK_REGEX =
	/\n\nPi documentation \(read only when the user asks about pi itself[\s\S]*?\(e\.g\., tui\.md for TUI API details\)/;

const PARAMETERS = Type.Object(
	{
		name: Type.String({
			minLength: 1,
			description: "The name of the skill to load.",
		}),
	},
	{ additionalProperties: false },
);

/** 统一的 details 形状 —— 所有返回分支都符合它,便于 UI 渲染与调试。 */
interface SkillToolDetails {
	/** 成功加载的 skill 名 */
	name?: string;
	/** SKILL.md 的绝对路径 */
	filePath?: string;
	/** 用于解析 SKILL.md 内相对路径的基目录 */
	baseDir?: string;
	/** pi 的资源来源信息 */
	sourceInfo?: SourceInfo;
	/** 失败时的机器可读原因 */
	error?: "no-skills" | "not-found" | "user-only" | "empty-body" | "aborted";
	/** 当前会话可被模型调用的 skill 名列表 */
	available?: string[];
}

type SkillEntry = {
	name: string;
	filePath: string;
	baseDir: string;
	sourceInfo: SourceInfo;
	disableModelInvocation: boolean;
};

/**
 * 与 pi 内部 escapeXml 完全一致(pi 没有导出它)。必要性:`formatSkillsForPrompt`
 * 对 <name>/<description>/<location> 都做了转义,要精确匹配那行 <location>,
 * 就必须用同样的转义规则。`&` 必须最先处理。
 */
function escapeXml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;");
}

/** `<location>` 行在提示里的确切形态(4 空格缩进 + 尾随换行)。 */
function locationLine(filePath: string): string {
	return `    <location>${escapeXml(filePath)}</location>\n`;
}

function readBody(filePath: string): string | null {
	try {
		const { body } = parseFrontmatter<Record<string, unknown>>(
			readFileSync(filePath, "utf8"),
		);
		const trimmed = body.trim();
		return trimmed.length > 0 ? trimmed : null;
	} catch {
		return null;
	}
}

export default function skillTool(pi: ExtensionAPI) {
	let skills: SkillEntry[] = [];
	let capturedPiDocs: string | null = null;
	const warned = new Set<string>();

	/**
	 * 同一条警告只说一次，避免每个 agent 循环都刷屏。
	 *
	 * 优先走 TUI 通知：pi 没有安装 process 的 warning 处理器，`emitWarning` 只会写 stderr，
	 * 全屏 TUI 里未必看得见。print / JSON 模式下 `ctx.ui` 是 pi 的 noOpUIContext（notify 为空函数），
	 * 所以那时回退到 stderr —— 脚本场景下它反而是唯一出口。
	 */
	function warnOnce(key: string, message: string, ctx?: ExtensionContext): void {
		if (warned.has(key)) return;
		warned.add(key);
		if (ctx?.hasUI) {
			ctx.ui.notify(message, "warning");
		} else {
			process.emitWarning(message, { code: "PI_SKILL_TOOL" });
		}
	}

	const visible = (list: SkillEntry[]) => list.filter((s) => !s.disableModelInvocation);
	const callable = () => (ALLOW_USER_ONLY ? skills : visible(skills));
	const names = () => {
		const list = callable().map((s) => s.name);
		if (capturedPiDocs && !list.includes(PI_DOCS_NAME)) {
			list.push(PI_DOCS_NAME);
		}
		return list;
	};

	// 捕获 pi 的发现结果,并把 skill 块改造成纯名称制。
	pi.on("before_agent_start", (event, ctx) => {
		let prompt = event.systemPrompt;
		let modified = false;

		// 剥离并捕获常驻的 Pi documentation 段落（将其下沉为内存虚拟技能）
		const docsMatch = prompt.match(PI_DOCS_BLOCK_REGEX);
		if (docsMatch) {
			capturedPiDocs = docsMatch[0].trim();
			prompt = prompt.replace(docsMatch[0], "");
			modified = true;
		} else if (prompt.includes("Available tools:")) {
			// 正则的失效面：头尾任一处措辞一变就整体失配。失配不报错，只是静默退化成
			// “docs 块照付 + pi-docs 不存在” —— 所以必须出声。`Available tools:` 是默认
			// 模板特有的标记，用来排除自定义 system prompt（那种提示里本来就没有这段）。
			warnOnce(
				"docs-block-not-found",
				"未在系统提示中找到 Pi documentation 段落(pi 的措辞可能已变更);已保留它,未注册虚拟技能 pi-docs。",
				ctx,
			);
		}

		const discovered = event.systemPromptOptions?.skills as SkillEntry[] | undefined;
		if (discovered && discovered.length > 0) skills = discovered;

		// pi 只在存在"模型可见"的 skill 时才生成那块提示 —— 没有就不必处理。
		const shown = visible(discovered ?? []);
		if (shown.length > 0) {
			const native = NATIVE_INSTRUCTIONS.find((line) =>
				prompt.includes(line),
			);
			if (!native) {
				// pi 换了措辞。不改提示(保持可用),只警告一次。
				warnOnce(
					"instruction-not-found",
					"pi 的 skill 加载指令未在系统提示中找到(措辞可能已变更);已保持提示原样,skill 工具仍可用。",
					ctx,
				);
			} else {
				// ① 加载指令:read/bash → skill
				prompt = prompt.replace(native, SKILL_INSTRUCTION);

				// ② 删掉相对路径解析规则 —— 路径加载模式的补丁,名称加载下多余。
				//    连同它那一行换行一起删,留下的空行正好把指令与 <available_skills> 隔开。
				prompt = prompt.replace(PATH_RULE, "");

				// ③ 删掉每条 <location> —— 模型不再按路径加载;留着是绕过工具的入口。
				//    逐条精确匹配(按各自的 filePath),不做结构性匹配;找不到就跳过,无害。
				let removed = 0;
				for (const skill of shown) {
					const line = locationLine(skill.filePath);
					if (prompt.includes(line)) {
						prompt = prompt.replace(line, "");
						removed += 1;
					}
				}
				if (removed === 0) {
					warnOnce(
						"locations-not-found",
						"未在系统提示中找到任何 <location> 行(pi 的输出格式可能已变更);已保留它们。",
						ctx,
					);
				}

				// ④ 在 <available_skills> 列表中追加注入 pi-docs 虚拟条目
				if (
					capturedPiDocs &&
					prompt.includes("</available_skills>") &&
					!prompt.includes(`<name>${PI_DOCS_NAME}</name>`)
				) {
					const virtualEntry = `  <skill>\n    <name>${PI_DOCS_NAME}</name>\n    <description>${PI_DOCS_DESC}</description>\n  </skill>\n</available_skills>`;
					prompt = prompt.replace("</available_skills>", virtualEntry);
				}
				modified = true;
			}
		}

		return modified ? { systemPrompt: prompt } : undefined;
	});

	pi.registerTool<typeof PARAMETERS, SkillToolDetails>({
		name: TOOL_NAME,
		label: "Skill",
		description: "Load a skill's full instructions and workflow by exact name.",
		promptSnippet: "Load a skill's full instructions by name",
		promptGuidelines: ["skill: load a skill by exact name when the task matches its description."],
		parameters: PARAMETERS,

		async execute(_toolCallId, params, signal) {
			const rawName = String(params.name ?? "").trim();
			const name = rawName.toLowerCase();

			if (signal?.aborted) {
				return {
					content: [{ type: "text" as const, text: "Aborted." }],
					details: { error: "aborted" as const },
				};
			}

			// 拦截虚拟技能 pi-docs：直接返回内存中捕获的文档指引与路径
			if (name === PI_DOCS_NAME) {
				if (!capturedPiDocs) {
					return {
						content: [
							{
								type: "text" as const,
								text: `Skill "${PI_DOCS_NAME}" is not available in this session.`,
							},
						],
						details: { error: "not-found" as const, available: names() },
					};
				}
				return {
					content: [
						{
							type: "text" as const,
							text: capturedPiDocs,
						},
					],
					details: {
						name: PI_DOCS_NAME,
					},
				};
			}

			if (skills.length === 0) {
				return {
					content: [
						{ type: "text" as const, text: "No skills are loaded in this session." },
					],
					details: { error: "no-skills" as const },
				};
			}

			// 优先精确匹配，其次自动做小写归一化容错（兼容模型传入 TDD、PDF、Grilling 等大小写幻觉）
			const skill =
				skills.find((s) => s.name === rawName) ??
				skills.find((s) => s.name.toLowerCase() === name);

			if (!skill) {
				return {
					content: [
						{
							type: "text" as const,
							text:
								`No skill named "${rawName}". ` +
								`Available: ${names().join(", ") || "(none)"}`,
						},
					],
					details: { error: "not-found" as const, available: names() },
				};
			}

			if (skill.disableModelInvocation && !ALLOW_USER_ONLY) {
				return {
					content: [
						{
							type: "text" as const,
							text:
								`Skill "${name}" is user-invocable only ` +
								`(disable-model-invocation: true). ` +
								`Ask the user to run /skill:${name}.`,
						},
					],
					details: { error: "user-only" as const, name: skill.name },
				};
			}

			const body = readBody(skill.filePath);
			if (body === null) {
				return {
					content: [
						{
							type: "text" as const,
							text: `Skill "${name}" has an empty or unreadable body (${skill.filePath}).`,
						},
					],
					details: {
						error: "empty-body" as const,
						name: skill.name,
						filePath: skill.filePath,
					},
				};
			}

			// 带上 baseDir:这是那条"相对路径规则"被删掉之后,模型解析正文里
			// 相对引用的唯一依据 —— 给的是结果,不是让它推导的规则。
			return {
				content: [
					{
						type: "text" as const,
						text: `Base directory: ${skill.baseDir}\n\n${body}`,
					},
				],
				details: {
					name: skill.name,
					filePath: skill.filePath,
					baseDir: skill.baseDir,
					sourceInfo: skill.sourceInfo,
				},
			};
		},
	});
}
