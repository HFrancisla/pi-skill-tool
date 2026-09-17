#!/usr/bin/env node
/**
 * 生成本地的 tsconfig.json。
 *
 * 为什么需要这个脚本:
 *   pi 的 SDK 类型住在**各人机器上的不同位置**(mise / nvm / 全局 npm / 本地 node_modules
 *   各不相同)。TypeScript 的 `paths` 不支持 `~` 展开,也写不出一个可移植的相对路径。
 *
 *   直接在仓库里硬编码绝对路径 → 泄漏主机目录结构,而且别人克隆后必然失败。
 *   把 SDK 装成 devDependency → 实测 node_modules 膨胀到 446 MB。
 *
 *   所以:仓库里只留这个脚本,tsconfig.json 是**生成物并已 gitignore**。
 *   任何人跑一次 `node scripts/gen-tsconfig.mjs` 就能得到适配自己机器的配置。
 *
 * 用法:
 *   node scripts/gen-tsconfig.mjs      # 生成/覆盖 tsconfig.json
 *   npm run typecheck                  # 等价于上面 + tsc --noEmit
 */

import { execSync } from "node:child_process";
import { existsSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import process from "node:process";

const PKG = "@earendil-works/pi-coding-agent";
const OUT = resolve(process.cwd(), "tsconfig.json");

/** 某个目录是否是一个可用的 pi SDK 安装(有类型入口)。 */
function isSdkRoot(dir) {
	return existsSync(join(dir, "dist", "index.d.ts"));
}

/** 收集候选位置,按可信度排序。 */
function candidates() {
	const out = [];

	// ① 从 `pi` 可执行文件反推。
	//    典型布局: <prefix>/bin/pi  →  <prefix>/lib/node_modules/@earendil-works/pi-coding-agent
	try {
		const sh = process.platform === "win32" ? "where pi" : "command -v pi";
		const found = execSync(sh, { shell: true, stdio: ["ignore", "pipe", "ignore"] })
			.toString()
			.split("\n")[0]
			.trim();
		if (found) {
			const bin = realpathSync(found);
			const prefix = resolve(dirname(bin), "..");
			out.push(join(prefix, "lib", "node_modules", ...PKG.split("/")));
			// Windows: <prefix>/node_modules/...
			out.push(join(prefix, "node_modules", ...PKG.split("/")));
		}
	} catch {
		/* 没装 pi 或不在这台机器上 —— 继续尝试其他候选 */
	}

	// ② 全局 npm root
	try {
		const root = execSync("npm root -g", { shell: true, stdio: ["ignore", "pipe", "ignore"] })
			.toString()
			.trim();
		if (root) out.push(join(root, ...PKG.split("/")));
	} catch {
		/* npm 不可用 */
	}

	// ③ 本地 node_modules(如果使用者选择装 devDependency)
	out.push(join(process.cwd(), "node_modules", ...PKG.split("/")));

	return [...new Set(out)];
}

const tried = candidates();
const sdkRoot = tried.find(isSdkRoot);

if (!sdkRoot) {
	console.error("✗ 找不到 pi 的 SDK 安装位置。尝试过:\n");
	for (const p of tried) console.error(`    ${p}`);
	console.error(
		"\n  请确认 pi 已安装(`pi --version` 可用),或在本目录执行 `npm install` 后重试。",
	);
	process.exit(1);
}

// typebox 是 pi 自带依赖;从 SDK 旁边解析(与 pi 运行时用同一个版本)
const typeboxCandidates = [
	join(sdkRoot, "node_modules", "typebox", "build", "index.d.mts"),
	join(sdkRoot, "node_modules", "typebox", "build", "index.d.ts"),
	join(process.cwd(), "node_modules", "typebox", "build", "index.d.mts"),
];
const typeboxEntry = typeboxCandidates.find(existsSync);

if (!typeboxEntry) {
	console.error(`✗ 在 ${sdkRoot} 旁边找不到 typebox 的类型定义。`);
	process.exit(1);
}

const tsconfig = {
	compilerOptions: {
		target: "ES2022",
		module: "ESNext",
		moduleResolution: "bundler",
		strict: true,
		noEmit: true,
		allowImportingTsExtensions: true,
		skipLibCheck: true,
		types: [],
		// 注意:不要加 baseUrl。
		// `paths` 里是绝对路径,本来就不需要 baseUrl;而 TypeScript 7 已经**移除了**
		// 这个选项(TS5102),加了会让 TS7 直接报错。已验证:去掉它后 TS 5.9 与 7.0 均通过。
		paths: {
			[PKG]: [join(sdkRoot, "dist", "index.d.ts")],
			typebox: [typeboxEntry],
		},
	},
	include: ["index.ts", "src/**/*.ts", "test/**/*.ts"],
};

writeFileSync(OUT, JSON.stringify(tsconfig, null, 2) + "\n");
console.log(`✓ 已生成 tsconfig.json`);
console.log(`    SDK:     ${sdkRoot}`);
console.log(`    typebox: ${typeboxEntry}`);
