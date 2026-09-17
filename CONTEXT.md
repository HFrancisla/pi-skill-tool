# pi-skill-tool

A Claude Code-compatible skill tool extension for Pi that adapts skill prompts to name-based invocation and sinks always-on documentation into an on-demand virtual skill.

## Language

**Skill**:
An executable set of specialized instructions, metadata, and workflows available to the agent or user.
_Avoid_: Plugin, tool, command, extension

**Physical Skill**:
A skill discovered by Pi that is backed by a concrete `SKILL.md` file on the local filesystem.
_Avoid_: Local skill, real skill, disk skill

**Virtual Skill**:
An in-memory synthetic skill entry injected into the system prompt and served dynamically by the tool without an on-disk `SKILL.md` file. Specifically used for `pi-docs`.
_Avoid_: Fake skill, mock skill, pseudo skill

**Hidden Skill**:
A physical skill marked with `disable-model-invocation: true`, invocable solely by the human via `/skill:name` and excluded from model prompt listings.
_Avoid_: Private skill, internal skill, user-only skill

**Prompt Transformation Pipeline**:
The text rewriting pipeline that converts Pi's path-based skill prompt into a name-based catalog, stripping `<location>` tags and sinking documentation blocks into virtual skills.
_Avoid_: Prompt compiler, prompt patcher, prompt middleware

**Base Directory**:
The absolute directory path of a physical skill provided at the head of tool execution output to enable relative path resolution.
_Avoid_: Skill path, root dir, cwd

**Skill Catalog**:
The registry and resolution engine that indexes physical and virtual skills, enforces model invocation permissions, and loads skill bodies.
_Avoid_: Skill manager, skill provider, skill repository
