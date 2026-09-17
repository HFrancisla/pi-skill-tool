# pi-skill-tool

为 [pi](https://github.com/earendil-works/pi) 补全 Claude Code 风格的 `skill` 工具，**将系统提示词中的技能列表改造成纯名称制，并将常驻 Pi 文档下沉为按需虚拟技能**。

> **源起**：在 Pi 中使用 Matt Pocock 的 skills 等社区技能库时，原生 Pi 用 `read` 加载技能、根本没有 `skill` 工具，于是技能正文里 `Call the Skill tool with "x"` 这类为 Claude Code 写的委派指令全成了**死指令**（pi 不校验技能正文，所以静默失效）：模型遇到委派只能反复报错重试、翻查目录或猜路径，流程极不顺畅。本扩展为此类生态体验优化与提示词瘦身而生。

零损失保留所有技能名称与描述，系统提示词累计瘦身 **~700 tokens**（实测基准：20 个 skill）。

---

## 核心功能

1. **打通技能委派**：全面兼容 `Call the Skill tool with "x"` 这类跨技能委派指令，抹平原版 pi 因缺少 `skill` 工具导致的多轮报错重试或猜路径成本，实现一步到位的丝滑加载。
2. **纯名称制加载（提示词瘦身）**：将原生提示词中每个技能附带的绝对路径 `<location>` 剔除，由工具在运行时自动向模型补齐 `Base directory`，技能列表体积减少约 24%（~466 tokens）。每个 skill 少一行 `<location>`，所以这部分收益随 skill 数量近似线性增长；`<location>` 路径越长省得越多。
3. **常驻 Pi 文档下沉为虚拟技能**：将硬编码常驻在系统提示词中的 `Pi documentation` 查阅指南（~230 tokens，与 skill 数量无关 —— 大小只取决于 pi 的文档块本身）剥离，自动转化为内存虚拟技能 `pi-docs`，仅在任务匹配时按需调取。
4. **不动隐藏技能的触发权**：标注 `disable-model-invocation: true` 的技能（在 Matt Pocock 的技能库里占近一半）保持 pi 原生语义 —— 只由你手动 `/skill:name` 触发，模型看不到也加载不了。它们发起的委派不受影响：`/skill:grill-me` 会把正文注入上下文，而委派目标（`grilling` 等）是可见技能。

> **关于第 4 条**：这是**有意保留的边界**，不是待办事项。`disable-model-invocation` 是技能作者的显式声明 —— 该技能只许人触发 —— 扩展默认不绕过它。顺带的好处：工具的失败列表（`Available: ...`）不会把隐藏技能名报给模型。
>
> 若确实想让模型也能按名字加载隐藏技能（例如希望「用 grill-me 帮我审一下」这类自然语言点名直接生效），把源码顶部的 `ALLOW_USER_ONLY` 改成 `true`。代价：绕过作者意图，且失败列表会泄露隐藏技能名。注意它是**源码级开关**，没有配置文件也没有环境变量；从 npm 安装的用户需要先克隆本仓库，改完后用 `pi install /绝对路径` 挂载本地副本。

---

## 技能类型与可见性

pi 里同时存在三类技能，差别不在内容而在**谁有权触发**：

| 类型 | 判定依据 | 进系统提示词？ | 模型能加载？ | 谁触发 |
|---|---|---|---|---|
| **普通技能** | 无 `disable-model-invocation` | ✅ `name` + `description` + `<location>`（本扩展删掉 `<location>`） | ✅ | 模型自主判断，或你 `/skill:name` |
| **隐藏技能** | `disable-model-invocation: true` | ❌ **整条不出现**（pi 的 `formatSkillsForPrompt` 直接过滤掉） | ❌ 返回 `user-only`，并提示模型请你运行 `/skill:name` | **只有你**，在输入框敲 `/skill:name` |
| **虚拟 `pi-docs`** | 由本扩展注入 | ✅ `name` + `description`（注入时就没有 `<location>`） | ✅ 从内存返回 pi 的文档块 | 模型（你问到 pi 自身相关的问题时） |

**“可见”有两个通道，别混淆**：隐藏技能只是对**模型**不可见，对**你**完全可见 —— 它们照常出现在 `/skill:` 补全菜单里（pi 的命令注册表不过滤隐藏技能），输入框敲名字永远能用（补全菜单可由设置 `enableSkillCommands` 关闭，默认开启；关掉只影响补全，直接敲命令照样展开）。这正是 `disable-model-invocation` 的语义：把触发权留给人。

两个容易踩的细节：

- **隐藏技能是“整条不出现”，不是“被删了路径”。** 本扩展删 `<location>` 只作用于 pi 已列出的条目；隐藏技能根本不在那份列表里，扩展也从不往列表里加隐藏技能。
- **`/skill:xxx` 只认磁盘上真实存在的技能**（走 pi 的资源加载器，与本扩展无关），所以对注入的 `pi-docs` 无效 —— 敲 `/skill:pi-docs` 只会把这段文字原样发给模型。

> 若把 `ALLOW_USER_ONLY` 改成 `true`，上表第二行的后两格会变成 ✅（模型也能加载隐藏技能），代价见上一节。

---

## 提示词改动效果

```diff
  Available tools:
+ - skill: Load a skill's full instructions by name

  Guidelines:
+ - skill: load a skill by exact name when the task matches its description.

- Pi documentation (read only when the user asks about pi itself, its SDK, extensions...):
- - Main documentation: /path/to/pi/README.md
- - Additional docs: /path/to/pi/docs
- - Examples: /path/to/pi/examples
- ... (下沉为虚拟技能 pi-docs, 节省 ~230 tokens) ...

  The following skills provide specialized instructions for specific tasks.
- Use the read tool to load a skill's file when the task matches its description.
+ Use the skill tool to load a skill by name when the task matches its description.
- When a skill file references a relative path, resolve it against the skill directory
- (parent of SKILL.md / dirname of the path) and use that absolute path in tool commands.

  <available_skills>
    <skill>
      <name>code-review</name>
      <description>Review the changes since a fixed point...</description>
-     <location>~/.pi/agent/skills/code-review/SKILL.md</location>
    </skill>
    ...(其余各条同样只删 <location> 行)...
+   <skill>
+     <name>pi-docs</name>
+     <description>Read documentation and development guides for pi itself, its SDK, extensions, themes, skills, and TUI.</description>
+   </skill>
  </available_skills>
```

---

## 工具规范 (Tool API Specification)

向底层大模型注册 `skill` 工具：

```json
{
  "name": "skill",
  "description": "Load a skill's full instructions and workflow by exact name.",
  "parameters": {
    "type": "object",
    "properties": {
      "name": {
        "type": "string",
        "minLength": 1,
        "description": "The name of the skill to load."
      }
    },
    "required": ["name"],
    "additionalProperties": false
  }
}
```

### 执行逻辑与返回格式

- **常规物理技能**：按名字在 pi 的发现结果里定位（`filePath` 由 pi 提供，不做文件系统搜索），自动剥离 YAML frontmatter；返回首行带上 `Base directory: <绝对路径>`，确保技能正文内的相对引用（如 `references/x.md`）可正常解析。
- **虚拟技能 `pi-docs`**：直接从内存闭包返回每次 agent 循环开始时从系统提示中捕获的文档块与真实路径，零磁盘 I/O。
- **大小写容错归一化**：当模型传入大写或首字母大写（如 `TDD`、`PDF`、`Grilling`）时自动进行小写归一化匹配，防止模型大小写幻觉导致执行失败。
- **统一 Details 结构**：执行失败时返回统一的机器可读标识（`no-skills`、`not-found`、`user-only`、`empty-body`、`aborted`）及清晰的文本提示。

---

## 安装与验证

### 安装

```bash
pi install npm:@hfrancisla/pi-skill-tool
```

### 验证

在终端执行带有内部委派的技能（如 `/skill:grill-me`），观察模型是否能够自动成功调用 `skill({"name": "grilling"})` 并获取正文执行。

想确认隐藏技能的边界，可以让模型试 `skill({"name": "grill-me"})` —— 应当返回 `user-only` 并请你改用 `/skill:grill-me`。

---

## 本地开发

克隆仓库后进行类型检查：

```bash
git clone https://github.com/HFrancisla/pi-skill-tool
cd pi-skill-tool
npm install
npm run typecheck
```

*注：`scripts/gen-tsconfig.mjs` 会自动定位本机 pi SDK 的绝对路径并生成适配本机的 `tsconfig.json`，无需安装庞大的 SDK 开发依赖。`scripts/` 与 `devDependencies` 都不进 npm 包，所以这套流程只在克隆的仓库里可用。*
