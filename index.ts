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
	type ExtensionAPI,
	type ExtensionContext,
	type SourceInfo,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { transformPrompt } from "./src/prompt-transformer.ts";
import { SkillCatalog } from "./src/skill-catalog.ts";

/** 小写以符合 pi 的内置工具惯例。 */
const TOOL_NAME = "skill";

/** true 则连 disable-model-invocation 的 skill 也允许模型加载（会绕过 skill 作者的手动触发设计，慎用）。 */
const ALLOW_USER_ONLY = false;

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

export default function skillTool(pi: ExtensionAPI) {
	const catalog = new SkillCatalog({ allowUserOnly: ALLOW_USER_ONLY });
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

	// 捕获 pi 的发现结果,并把 skill 块改造成纯名称制。
	pi.on("before_agent_start", (event, ctx) => {
		const discovered = event.systemPromptOptions?.skills as SkillEntry[] | undefined;
		catalog.update({ skills: discovered });

		const result = transformPrompt({
			prompt: event.systemPrompt,
			skills: discovered,
			existingCapturedDocs: catalog.getCapturedDocs(),
		});

		if (result.capturedDocs) {
			catalog.update({ capturedDocs: result.capturedDocs });
		}

		for (const warning of result.warnings) {
			warnOnce(warning.code, warning.message, ctx);
		}

		return result.modified ? { systemPrompt: result.prompt } : undefined;
	});

	pi.registerTool<typeof PARAMETERS, SkillToolDetails>({
		name: TOOL_NAME,
		label: "Skill",
		description: "Load a skill's full instructions and workflow by exact name.",
		promptSnippet: "Load a skill's full instructions by name",
		promptGuidelines: ["skill: load a skill by exact name when the task matches its description."],
		parameters: PARAMETERS,

		async execute(_toolCallId, params, signal) {
			if (signal?.aborted) {
				return {
					content: [{ type: "text" as const, text: "Aborted." }],
					details: { error: "aborted" as const },
				};
			}

			const outcome = catalog.resolve(params.name);

			if (outcome.ok) {
				if (outcome.kind === "virtual") {
					return {
						content: [{ type: "text" as const, text: outcome.content }],
						details: { name: outcome.name },
					};
				}
				return {
					content: [{ type: "text" as const, text: outcome.content }],
					details: {
						name: outcome.name,
						filePath: outcome.filePath,
						baseDir: outcome.baseDir,
						sourceInfo: outcome.sourceInfo as SourceInfo,
					},
				};
			}

			switch (outcome.error) {
				case "not-found":
					return {
						content: [{ type: "text" as const, text: outcome.message }],
						details: { error: "not-found", available: outcome.available },
					};
				case "user-only":
					return {
						content: [{ type: "text" as const, text: outcome.message }],
						details: { error: "user-only", name: outcome.skillName },
					};
				case "empty-body":
					return {
						content: [{ type: "text" as const, text: outcome.message }],
						details: {
							error: "empty-body",
							name: outcome.skillName,
							filePath: outcome.filePath,
						},
					};
				case "no-skills":
					return {
						content: [{ type: "text" as const, text: outcome.message }],
						details: { error: "no-skills" },
					};
			}
		},
	});
}
