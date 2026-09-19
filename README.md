# pi-skill-tool

A pi extension that adds a Claude Code-style `skill` tool for loading additional skills by name.

## What It Does

- Registers `skill({ name })` for model-driven skill loading and skill-to-skill delegation.
- Preserves pi's native `/skill:name` command. User-invoked skills are expanded by pi before the model runs.
- Prevents the tool from rereading a skill that was already expanded by `/skill:name` or loaded earlier in the same turn.
- Rewrites the model-facing skill catalog to point at the `skill` tool instead of direct file reads.
- Removes redundant skill file locations from the model-facing catalog.
- Exposes pi's built-in documentation as an in-memory `pi-docs` skill when available.

The extension does not change the contents of a skill. It strips frontmatter when returning a skill body and adds its base directory so relative paths in that body can be resolved.

## Install

```bash
pi install npm:@hfrancisla/pi-skill-tool
```

Restart pi after installation if the current session does not load the extension automatically.

## Usage

User-invoked skill:

```text
/skill:grill-with-docs
```

Pi expands the command into the full skill block before sending the turn to the model. The model can then follow that skill and load additional skills it names:

```text
skill({"name":"grilling"})
skill({"name":"domain-modeling"})
```

The `skill` tool accepts one exact skill name:

```json
{
  "name": "grilling"
}
```

The tool keeps pi's visibility rules:

- A normal skill can be loaded by the model when its description matches the task.
- A skill with `disable-model-invocation: true` can be activated by the user with `/skill:name`, but cannot be loaded by the model before that explicit activation.
- A repeated request for a skill already loaded in the current turn returns `already-loaded` and does not reread the file.

## Tool Contract

```text
description: Load a skill's full instructions and workflow by exact name.
parameter:  { name: string }
```

A physical skill result contains its instructions and base directory. The virtual `pi-docs` skill is returned from memory and does not require a skill file.

## Development

```bash
npm install
npm test
npm run typecheck
npm pack --dry-run
```

`npm run typecheck` resolves the installed pi SDK from the `pi` executable, the global npm root, or local `node_modules`.

## Release

Check the package contents before publishing:

```bash
npm pack --dry-run
npm publish --access public
```

This package is public and uses the MIT license.
