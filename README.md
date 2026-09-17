# pi-skill-tool

为 [pi](https://github.com/earendil-works/pi) 补全 Claude Code 风格的 `skill` 工具，**将系统提示词中的技能列表改造成纯名称制，并将常驻 Pi 文档下沉为按需虚拟技能**。

> **源起**：在 Pi 中使用 Matt Pocock 的 skills 等社区技能库时，原生 Pi 因缺少 `skill` 工具且屏蔽了 `disable-model-invocation: true` 技能，模型遇到委派指令时常因找不到工具而经历多轮报错重试、翻查或猜路径，流程极不顺畅。本扩展为此类生态体验优化与提示词瘦身而生。

零损失保留所有技能名称与描述，系统提示词累计瘦身 **~700 tokens**（实测基准：20 个 skill）。

---

## 核心功能

1. **打通技能委派**：全面兼容 `Call the Skill tool with "x"` 这类跨技能委派指令，抹平原版 pi 因缺少 `skill` 工具导致的多轮报错重试或猜路径成本，实现一步到位的丝滑加载。
2. **纯名称制加载（提示词瘦身）**：将原生提示词中每个技能附带的绝对路径 `<location>` 剔除，由工具在运行时自动向模型补齐 `Base directory`，技能列表体积减少约 24%（~466 tokens）。每个 skill 少一行 `<location>`，所以这部分收益随 skill 数量近似线性增长；`<location>` 路径越长省得越多。
3. **常驻 Pi 文档下沉为虚拟技能**：将硬编码常驻在系统提示词中的 `Pi documentation` 查阅指南（~230 tokens，与 skill 数量无关 —— 大小只取决于 pi 的文档块本身）剥离，自动转化为内存虚拟技能 `pi-docs`，仅在任务匹配时按需调取。
4. **支持隐藏技能按需懒加载**：对于标注 `disable-model-invocation: true` 的隐藏技能（平时完全不进入系统提示词以省 Token），只要在会话中被用户口头点名或被其他技能委派，模型即可成功加载，避免流程中断。

> **关于第 4 条**：隐藏技能可被模型加载是默认行为，对应源码顶部的 `ALLOW_USER_ONLY = true`。若要严格复刻 pi 原生语义 —— 隐藏技能只能由你手动 `/skill:name` 触发、模型一律不得加载 —— 把该常量改成 `false` 即可。注意它是**源码级开关**，没有配置文件也没有环境变量；从 npm 安装的用户需要先克隆本仓库，改完后用 `pi install /绝对路径` 挂载本地副本。

---

## 提示词改动效果

```diff
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

- **常规物理技能**：精确定位 `SKILL.md`，自动剥离 YAML frontmatter；返回首行带上 `Base directory: <绝对路径>`，确保技能正文内的相对引用（如 `references/x.md`）可正常解析。
- **虚拟技能 `pi-docs`**：直接从内存闭包返回启动时动态捕获的当前环境真实文档路径与指南，零磁盘 I/O。
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
