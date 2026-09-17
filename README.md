# pi-skill-tool

A Claude Code-compatible `skill` tool extension for [pi](https://github.com/earendil-works/pi). Loads skills directly by exact name, supports skill delegation directives (such as `Call the Skill tool with "..."`), strips redundant `<location>` file paths from system prompts, and converts the static Pi documentation block into an on-demand virtual skill — saving ~700 prompt tokens.

---

## Features

- **Name-Based Skill Loading**: Registers a `skill` tool to retrieve skill instructions by exact name and automatically prepends `Base directory: <path>` to resolve internal relative paths.
- **Cross-Skill Delegation**: Directly supports skill-to-skill delegation patterns like `Call the Skill tool with "..."`.
- **Prompt Token Savings**: Strips `<location>` paths from `<available_skills>` in the system prompt, reducing skill list tokens by ~24%.
- **On-Demand Pi Docs**: Converts the static Pi documentation block into a virtual `pi-docs` skill, loaded only when questions relate to Pi (~230 tokens saved).
- **Respects Native Visibility**: Preserves `disable-model-invocation: true`. Hidden skills are excluded from model visibility and can only be triggered manually via `/skill:name`.

---

## Prompt Changes

```diff
  Available tools:
+ - skill: Load a skill's full instructions by name

  Guidelines:
+ - skill: load a skill by exact name when the task matches its description.

- Pi documentation (read only when the user asks about pi itself, its SDK, extensions...):
- - Main documentation: /path/to/pi/README.md
- - Additional docs: /path/to/pi/docs
- - Examples: /path/to/pi/examples
- ... (converted to virtual skill pi-docs, saving ~230 tokens) ...

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
    ...(remaining skills also have <location> removed)...
+   <skill>
+     <name>pi-docs</name>
+     <description>Read documentation and development guides for pi itself, its SDK, extensions, themes, skills, and TUI.</description>
+   </skill>
  </available_skills>
```

---

## Skill Types & Permissions

| Type | Criteria | In System Prompt | Model Invocation | Manual Trigger |
|---|---|---|---|---|
| **Standard Skills** | Without `disable-model-invocation` | `name` & `description` | Allowed (`skill`) | Allowed (`/skill:name`) |
| **Hidden Skills** | `disable-model-invocation: true` | Excluded | Blocked (returns `user-only`) | Allowed (`/skill:name`) |
| **Virtual Skills** | Injected `pi-docs` | `name` & `description` | Allowed (in-memory) | Not supported |

> Note: To allow models to load hidden skills, set `ALLOW_USER_ONLY` to `true` in source code.

---

## Tool API Specification

Tool definition registered with the model:

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

### Execution Details

- **Physical Skills**: Matches the skill from Pi's catalog, strips YAML frontmatter, and prepends `Base directory: <path>` to the returned instructions.
- **Virtual Skill (`pi-docs`)**: Directly returns the captured Pi documentation from memory.
- **Case-Insensitive Fallback**: Automatically normalizes input names to lowercase (e.g. `TDD` resolves to `tdd`).
- **Structured Error Feedback**: Returns machine-readable error codes (`not-found`, `user-only`, `empty-body`, `no-skills`) and lists currently available skills on failure.

---

## Installation & Usage

### Installation

```bash
pi install npm:@hfrancisla/pi-skill-tool
```

### Usage

Once installed, the model automatically calls the `skill` tool when relevant (e.g. `skill({"name": "grilling"})`). Hidden skills remain accessible via the `/skill:<name>` command.

---

## Local Development

```bash
git clone https://github.com/HFrancisla/pi-skill-tool
cd pi-skill-tool
npm install
npm test
npm run typecheck
```

> `scripts/gen-tsconfig.mjs` automatically locates the local Pi SDK installation and generates a matching `tsconfig.json`.
