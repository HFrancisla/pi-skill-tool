# pi-skill-tool

给 pi 补上 Claude Code 那个 `skill` 工具,**并把系统提示里的 skill 块改造成纯名称制**。

只删路径,不动名称与描述 —— 实测块体积 **−24%**,保真度零损失。

---

## 为什么

为 Claude Code 写的 skill 里有这种句子:

```markdown
Call the Skill tool with "grilling".
```

Claude Code 自己的提示词是:

```
The following skills are available for use with the Skill tool:
<目录>
```

—— **目录留在系统提示里,`Skill` 工具负责执行。**

而原版 pi 用 `read` 加载 skill,**没有这个工具**。于是上面那句话在 pi 里是**死指令**。更糟的是 pi **不校验 skill 正文**,所以它静默失效、不报错 —— 模型读到一句无法执行的指令,只能自己猜着绕过。

本扩展把工具补上,**并把整个块改成名称制**,于是:

- **一个标识符空间(名称)** —— 不再出现"指令说名称、数据给路径"的割裂
- **一条加载路径** —— 不再有 `read` 与 `skill` 双指引
- skill 之间的委派(`Call the Skill tool with X`)可执行
- 名称与描述**保真度零损失**,同时省下约 24% 的块体积

---

## 改动速览

**一句话:把 skill 块从「路径制」改成「名称制」。**

| | 原来 | 现在 |
|---|---|---|
| 提示告诉模型 | **用 `read` 打开那个文件** | **用 `skill` 按名字加载** |
| 目录里给每条附上 | **绝对路径** `<location>` | **只有名字和描述** |

| # | 改动 | 行数 | 为什么 |
|---|---|---|---|
| ① **换** | `Use the **read** tool to load a skill's **file**`<br>→ `Use the **skill** tool to load a skill **by name**` | 1 | 把加载路径指向本工具。措辞贴着原生那句写,便于模型迁移 |
| ② **删** | 「相对路径要相对 skill 目录解析」规则 | 1 | 那是**路径加载模式的补丁** —— 模型 `read` 到一个 SKILL.md 后,得自己算出它在哪个目录,才能解析正文里的 `references/x.md`。名称加载下工具**直接返回 `Base directory: <绝对路径>`**:给的是**结果**,不是让模型推导的**规则** |
| ③ **删** | 每条 `<location>绝对路径</location>` | **20** | 模型不再按路径加载;留着就是**绕过工具的入口**,与 ① 矛盾 |

**净效果:7,701 → 5,838 字符(−24%,≈466 tokens),而 20 条 name/description 一字未动。**

---

## 改动示例

### 精简 diff

```diff
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
    <skill>
      <name>codebase-design</name>
      <description>Shared vocabulary for designing deep modules...</description>
-     <location>~/.pi/agent/skills/codebase-design/SKILL.md</location>
    </skill>
    ...(其余 18 条同样只删 <location> 行)...
  </available_skills>
```

**`+` 只有 1 行,`-` 共 21 行**(20 条路径 + 1 条规则),**其余全部原样。**

### 改造前 → 改造后

只列前 4 行 + 1 条完整条目 + 收尾。中间 19 条形状相同。

**改造前** — 7,701 字符 / 112 行

```text
                                                        (空行)
The following skills provide specialized instructions for specific tasks.
Use the read tool to load a skill's file when the task matches its description.   ← ① 换
When a skill file references a relative path, resolve it against the skill        ← ② 删
directory (parent of SKILL.md / dirname of the path) and use that absolute path
in tool commands.

<available_skills>
  <skill>
    <name>code-review</name>
    <description>Review the changes since a fixed point…</description>
    <location>~/.pi/agent/skills/code-review/SKILL.md</location>          ← ③ 删(共 20 条)
  </skill>
  ...
</available_skills>
```

**改造后** — 5,838 字符 / 91 行

```text
                                                        (空行)
The following skills provide specialized instructions for specific tasks.
Use the skill tool to load a skill by name when the task matches its description.

<available_skills>
  <skill>
    <name>code-review</name>
    <description>Review the changes since a fixed point…</description>
  </skill>
  ...
</available_skills>
```

> 两块里只有 `description` 被 `…` 截短(实际是完整的一句话,本扩展未动它)。
> 其余长行是**为排版折行的** —— `Use the read tool…` 与 `When a skill file
> references…` 在真实提示里**各是一整行**。

---

## 运行时对比

同一个动作 —— **加载 `code-review`** —— 前后差别:

**改造前**

```
读提示  →  "Use the read tool to load a skill's file"
查目录  →  <location>~/.pi/agent/skills/code-review/SKILL.md</location>
调工具  →  read("~/.pi/agent/skills/code-review/SKILL.md")
拿到    →  文件原文(含 frontmatter)
```

**改造后**

```
读提示  →  "Use the skill tool to load a skill by name"
查目录  →  <name>code-review</name>
调工具  →  skill({"name": "code-review"})
拿到    →  "Base directory: ~/.pi/agent/skills/code-review"
           + 正文(frontmatter 已剥掉)
```

**三个变化:**

1. **定位靠名字,不靠路径** —— 模型不需要知道文件在哪
2. **路径由工具补上** —— 返回时带 `Base directory:`,所以正文里的相对引用照样能解析
   → 这正是 ② 那条规则被删掉之后仍然安全的原因
3. **frontmatter 不再进上下文** —— 工具读了就剥掉

---

## 示例:修复一个失效的委派

你目录里有 **7 个 skill** 写了 `Call the Skill tool with "x"`。以 `grill-me` 为例:

```
你输入      /skill:grill-me
              ↓  pi 展开成 skill block(这一步不受本扩展影响)
模型读到    Call the Skill tool with "grilling".
              ↓
┌─ 改造前 ────────────────────────────────────────────┐
│ ✗ 工具表里没有 Skill / skill                         │
│   → 这句话是空话,模型只能自己猜着绕过                  │
│   → pi 不校验 skill 正文,所以没有任何报错              │
└─────────────────────────────────────────────────────┘
┌─ 改造后 ────────────────────────────────────────────┐
│ ✓ skill({"name": "grilling"})                       │
│   → 真的加载到 grilling 的正文                        │
└─────────────────────────────────────────────────────┘
```

那 7 个 skill 的**委派目标**(`grilling` / `domain-modeling` / `codebase-design`
/ `research` / `prototype`)全部是模型可见的,所以都能跑通。

---

## 装

```bash
pi install npm:@hfrancisla/pi-skill-tool
```

本地路径不会被钉 ref。之后改这个目录里的文件即生效,必要时 `/reload`。

## 验证

```
/skill:grill-me
```

以前 `grill-me` 的正文 "Call the Skill tool with 'grilling'" 是空话;
现在模型能真的调用 `skill("grilling")` 并拿到 `grilling` 的正文。

想确认提示被改造,可以问模型:"系统提示里关于 skill 的那一段原文是什么?"

---

## 工作原理

```
【每次 agent 循环开始前 · before_agent_start】
  ① 读 event.systemPromptOptions.skills   ← pi 已加载的完整 skill 列表(全集)
  ② 存进模块级变量 skills
  ③ 若存在模型可见的 skill:
     · 定位 pi 的原生加载指令(read/bash 二选一)
     · 替换成指向 skill 工具的那句
     · 删掉相对路径规则
     · 逐条删掉 <location>
     · return { systemPrompt: 改造后的 }       ← 只返回变化的部分
     定位失败(pi 换了措辞):
     · 不改提示,只警告一次;工具仍可用

【模型调用 skill({"name":"grilling"})】
  ④ skills.find(s => s.name === name)      ← 精确名字查找(输入永不成为路径)
  ⑤ 检查 disableModelInvocation
  ⑥ readFileSync(skill.filePath)
  ⑦ parseFrontmatter(...) → 取 body、trim  ← 剥掉 frontmatter
  ⑧ 返回 "Base directory: <dir>\n\n<body>"
                                            ↑ 这是②被删掉之后,模型解析正文里
                                              相对引用的唯一依据
```

### 为什么不用正则匹配整块

`@arhen/pi-core-skill-tool` 用正则匹配从 `The following skills provide...` 到 `</available_skills>` 的**整块**并删掉:

```js
/\n\nThe following skills provide specialized instructions for specific tasks\.\n
 Use the read tool to load a skill's file[\s\S]*<\/available_skills>\n?/
```

那是**结构性**匹配 —— pi 调整块内任何内容(多加一行、改个标签)都会失配。

本扩展**只做三处精确字符串替换**:

| 替换对象 | 形态 | 失配时 |
|---|---|---|
| 原生加载指令 | 一句完整的话(pi 源码里的三元表达式,两变体都试) | **不改提示 + 警告一次** |
| 相对路径规则 | 一句完整的话 | 静默跳过(无害) |
| `<location>` 行 | `    <location>` + **转义后的该 skill 文件路径** + `</location>\n` | 静态计数,一条都没删到才警告 |

**逐条按各自 filePath 精确匹配**,所以不依赖块的边界、行序或缩进变化。路径唯一,不会误删。

`escapeXml` 是必需的:pi 对 `<location>` 的值做了 XML 转义(`&`→`&amp;` 等),
要精确匹配那行就必须用同样的规则。pi 没有导出这个内部函数,所以这里复刻了 5 行。

---

## 设计取舍

| 决定 | 理由 |
|---|---|
| **工具名用小写 `skill`** | 符合 pi 内置工具惯例。在 Anthropic 系 provider 上 pi 会经 `ccToolLookup` 自动转成 `Skill`;在 OpenAI 兼容 provider 上原样为 `skill` |
| **只删路径,不删描述** | 保真度优先。描述是模型发现 skill 的**唯一依据**,截断它就是拿发现能力换 token |
| **目录来自 pi 的发现结果** | `event.systemPromptOptions.skills`。pi 的类型定义原话:*"Extensions can inspect this to understand what Pi loaded **without re-discovering resources**"* |
| **剥掉 frontmatter 再返回** | frontmatter 是给 harness 的元数据,不该进模型上下文 |
| **返回时带 `baseDir`** | 这是删掉"相对路径规则"之后,模型的唯一解析依据 |
| **`disable-model-invocation` 的 skill 拒绝模型调用** | 那些是你手动 `/skill:name` 专用的。想放开就把 `ALLOW_USER_ONLY` 改成 `true` |
| **失配时不改提示只警告** | pi 升级换措辞时,最坏情况是"退回原生行为",而不是提示被破坏 |

---

## 与另外两个扩展的区别

| | `@arhen/pi-core-skill-tool` | `@valdo766hi/pi-lazy-skill-tool` | **本扩展** |
|---|---|---|---|
| 工具 | `skill` | `skill` + `skill_search` | **`skill`** |
| 目录位置 | 搬到工具 description | 搬到任务局部消息 | **原地不动** |
| **描述保真度** | ❌ 截断 100 字符 | ✅ 完整 | ✅ **完整** |
| 路径信息 | 整块删掉 | 整块重建 | **只删路径那 21 行** |
| 省 token | ✅ ~4,500 | ✅ | ✅ **466** |
| 怎么省的 | **截断描述**(你的中位数 336 字符 → 100,砍 70%) | **短名单 + 分页**(多一次搜索步骤) | **删名称加载下冗余的路径**(零代价) |
| 改动幅度 | 搬走 + 截断 | 搬走 + 重建 + 路由 | **3 处精确替换** |
| 失效面 | 正则匹配整块 | 锚定 pi formatter | **3 个精确字符串** |
| 代码量 | 145 行 | 4,901 行 | ~290 行 |
| pi peer | `^0.84.2` ⚠️ 排除 0.85.x | `>=0.85.1 <0.86.0` | `*`(pi 文档推荐) |

**省得比它们少,但没有保真度代价、没有额外步骤、没有结构性匹配。**

---

## 已知边界

- **`<location>` 删除后,模型不能再绕过工具直接 `read` skill 文件** —— 这正是目的。
- **但兜底没丢**:`/skill:name` 走 pi 的命令注册表(`getSkills` + `getCommands`),**与系统提示无关**。所以即使工具出问题,你仍能手动调用任何一个 skill。
- **目录在 `before_agent_start` 时才拿到** —— 工具在首个 agent 循环开始前就绪,正常流程无窗口期。
- **`promptSnippet` 是必需的**:pi 的类型定义写明 *"Custom tools are omitted from that section when this is not provided"*。已提供。
- **`label: "Skill"` 只用于 UI**;模型在 API 里看到的是 `name`,即 **`skill`**。
- **未做**:不分页、不做权限策略、不做工具冲突检测。需要这些请用 valdo。
- **假设**名字加载下不需要路径。如果将来 pi 或某个 provider 要求模型按路径 read skill,这个改造需要回退。

## 类型检查

```bash
npm run typecheck      # = node scripts/gen-tsconfig.mjs && tsc --noEmit
```

### 为什么仓库里没有 `tsconfig.json`

pi 的 SDK 类型住在**每台机器上的不同位置**(mise / nvm / 全局 npm / 本地 `node_modules`
各不相同)。TypeScript 的 `paths` 不支持 `~` 展开,也写不出一个可移植的相对路径。

两条路都不理想:

| 做法 | 问题 |
|---|---|
| 硬编码绝对路径进仓库 | **泄漏主机目录结构**;别人克隆后 typecheck 必然失败 |
| 把 SDK 装成 `devDependency` | 实测 `node_modules` 膨胀到 **446 MB** —— 对一个 ~290 行的扩展太重 |

所以:**仓库里只留生成器,`tsconfig.json` 是生成物并已 gitignore。**

```
scripts/gen-tsconfig.mjs
  ① 从 `pi` 可执行文件反推 SDK 位置
  ② 回退到 `npm root -g`
  ③ 再回退到本地 `node_modules`
  → 写出适配本机的 tsconfig.json(含绝对路径,但不进版本库)
```

`typebox` 的类型从 **SDK 旁边**解析 —— 与 pi 运行时用的是同一个版本,不会漂移。
