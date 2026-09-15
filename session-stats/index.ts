// session-stats — /info (aliases /stats, /statistics, /session-stats) for Pi.
//
// Everything about the current harness + session that does not fit the
// compact footer:
//   • harness: pi/node versions, process uptime, loaded extensions
//   • workspace: full pwd, git branch/state, added/deleted lines, ahead/behind
//   • tools & MCP: registered/active counts, MCP servers, estimated context
//     footprint of active tool definitions, top tools actually used
//   • skills: installed vs referenced in this session
//   • tokens & cost: totals, per-direction breakdown, context-window usage
//   • session file path/size, compactions, model switches
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

interface UsageLike {
	input?: number;
	output?: number;
	cacheRead?: number;
	cacheWrite?: number;
	reasoning?: number;
	cost?: { total?: number };
}

interface EntryLike {
	type?: string;
	customType?: string;
	timestamp?: string;
	message?: {
		role?: string;
		usage?: UsageLike;
		toolName?: string;
	};
}

interface ToolInfoLite {
	name: string;
	description?: string;
	parameters?: unknown;
	sourceInfo?: { path?: string };
}

function fmt(n: number): string {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
	if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
	return `${n}`;
}

function fmtDuration(ms: number): string {
	const s = Math.floor(ms / 1000);
	const h = Math.floor(s / 3600);
	const m = Math.floor((s % 3600) / 60);
	const sec = s % 60;
	return h > 0 ? `${h}h ${m}m ${sec}s` : m > 0 ? `${m}m ${sec}s` : `${sec}s`;
}

function shortHome(p: string): string {
	const home = homedir();
	return p.startsWith(home) ? `~${p.slice(home.length)}` : p;
}

function git(args: string[], cwd: string): string | null {
	try {
		return execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "ignore"] })
			.toString()
			.trim();
	} catch {
		return null;
	}
}

function readJson(path: string): any | undefined {
	try {
		return JSON.parse(readFileSync(path, "utf-8"));
	} catch {
		return undefined;
	}
}

/** Rough LLM-token estimate for a tool definition (≈4 chars/token). */
function toolContextTokens(t: ToolInfoLite): number {
	let chars = (t.description ?? "").length;
	try {
		chars += JSON.stringify(t.parameters ?? {}).length;
	} catch {
		/* circular params — ignore */
	}
	return Math.ceil(chars / 4);
}

function collectSkills(): string[] {
	const skills = new Set<string>();
	const settings = readJson(join(homedir(), ".pi", "agent", "settings.json")) as
		| { skills?: string[] }
		| undefined;
	const dirs = [...(settings?.skills ?? []), join(homedir(), ".pi", "agent", "skills")];
	for (const dir of dirs) {
		if (!existsSync(dir)) continue;
		for (const entry of listDirs(dir)) {
			if (existsSync(join(dir, entry, "SKILL.md"))) skills.add(entry);
		}
	}
	return [...skills].sort();
}

function listDirs(dir: string): string[] {
	try {
		return execFileSync("find", [dir, "-maxdepth", "1", "-mindepth", "1", "-type", "d"], {
			stdio: ["ignore", "pipe", "ignore"],
		})
			.toString()
			.trim()
			.split("\n")
			.filter(Boolean)
			.map((p) => p.split("/").pop() as string);
	} catch {
		return [];
	}
}

export default function sessionStats(pi: unknown) {
	const api = pi as {
		registerCommand: (
			name: string,
			opts: { description: string; handler: (args: string, ctx: any) => void },
		) => void;
		getAllTools?: () => ToolInfoLite[];
		getActiveTools?: () => string[];
		getThinkingLevel?: () => string;
	};

	const handler = (_args: string, ctx: any) => {
		const cwd = ctx?.cwd ?? process.cwd();
		const entries: EntryLike[] = ctx?.sessionManager?.getBranch?.() ?? [];

		// ── session aggregates ──────────────────────────────────────────
		let input = 0,
			output = 0,
			cacheRead = 0,
			cacheWrite = 0,
			reasoning = 0,
			cost = 0,
			userMsgs = 0,
			assistantMsgs = 0,
			modelSwitches = 0,
			compactions = 0;
		let firstTs: number | undefined;
		const toolUse = new Map<string, number>();
		const skillsUsed = new Set<string>();

		for (const entry of entries) {
			if (entry.type === "model_change") modelSwitches++;
			if (entry.type === "compaction" || entry.customType?.includes("compaction")) compactions++;
			if (entry.timestamp && firstTs === undefined) firstTs = Date.parse(entry.timestamp);
			const msg = entry.message;
			if (!msg) continue;
			if (msg.role === "user") userMsgs++;
			if (msg.role === "assistant") {
				assistantMsgs++;
				const u = msg.usage ?? {};
				input += u.input ?? 0;
				output += u.output ?? 0;
				cacheRead += u.cacheRead ?? 0;
				cacheWrite += u.cacheWrite ?? 0;
				reasoning += u.reasoning ?? 0;
				cost += u.cost?.total ?? 0;
			}
			if (msg.role === "toolResult" && msg.toolName) {
				toolUse.set(msg.toolName, (toolUse.get(msg.toolName) ?? 0) + 1);
				if (/skill/i.test(msg.toolName)) skillsUsed.add(msg.toolName);
			}
			if (entry.customType && /skill/i.test(entry.customType)) skillsUsed.add(entry.customType);
		}
		const totalTokens = input + output + cacheRead + cacheWrite + reasoning;
		// Cache hit rate over all prompt tokens (what could have been cached).
		const promptTokens = input + cacheRead + cacheWrite;
		const cacheHitPct = promptTokens > 0 ? Math.round((cacheRead / promptTokens) * 100) : null;

		// ── workspace ───────────────────────────────────────────────────
		const home = homedir();
		const branch = git(["rev-parse", "--abbrev-ref", "HEAD"], cwd);
		const numstat = git(["diff", "--numstat", "HEAD"], cwd) ?? "";
		let added = 0,
			deleted = 0;
		for (const line of numstat.split("\n")) {
			const [a, d] = line.split("\t");
			added += parseInt(a, 10) || 0;
			deleted += parseInt(d, 10) || 0;
		}
		const upstream = branch ? git(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], cwd) : null;
		const aheadBehind =
			upstream && branch ? git(["rev-list", "--left-right", "--count", `${upstream}...HEAD`], cwd) : null;
		const dirty = (git(["status", "--porcelain"], cwd) ?? "").length > 0;

		// ── tools & MCP ─────────────────────────────────────────────────
		const allTools = (() => {
			try {
				return api.getAllTools?.() ?? [];
			} catch {
				return [];
			}
		})();
		const activeTools = new Set((() => {
			try {
				return api.getActiveTools?.() ?? [];
			} catch {
				return [];
			}
		})());
		const mcpServers: string[] = Object.entries(
			readJson(join(homedir(), ".pi", "agent", "mcp.json"))?.mcpServers ?? {},
		)
			.filter(([, def]: [string, any]) => def?.disabled !== true)
			.map(([name]) => name);
		const mcpTools = allTools.filter(
			(t) => typeof t.sourceInfo?.path === "string" && /mcp/i.test(t.sourceInfo.path),
		);
		const activeMcpTools = mcpTools.filter((t) => activeTools.has(t.name));
		let activeToolCtxTokens = 0;
		for (const t of allTools) {
			if (activeTools.size === 0 || activeTools.has(t.name)) activeToolCtxTokens += toolContextTokens(t);
		}
		const topTools = [...toolUse.entries()]
			.sort((a, b) => b[1] - a[1])
			.slice(0, 5)
			.map(([name, n]) => `${name}×${n}`)
			.join(" · ");

		// ── skills ──────────────────────────────────────────────────────
		const installedSkills = collectSkills();

		// ── session file ────────────────────────────────────────────────
		let sessionFileLine = "";
		const sessionPath = process.env.PI_SESSION_FILE ?? ctx?.sessionManager?.getSessionFilePath?.();
		if (sessionPath && existsSync(sessionPath)) {
			const kb = statSync(sessionPath).size / 1024;
			sessionFileLine = `\nSession file: ${shortHome(sessionPath)} (${kb < 1024 ? `${kb.toFixed(0)} KB` : `${(kb / 1024).toFixed(1)} MB`})`;
		}

		// ── harness ─────────────────────────────────────────────────────
		let piVersion = "";
		try {
			const pkg = readJson(
				join(homedir(), ".npm-global/lib/node_modules/@earendil-works/pi-coding-agent/package.json"),
			);
			piVersion = pkg?.version ? `pi ${pkg.version}` : "";
		} catch {
			/* ignore */
		}
		const extCount = (readJson(join(homedir(), ".pi", "agent", "settings.json")) as any)?.extensions?.length;
		const think = (() => {
			try {
				return api.getThinkingLevel?.() ?? ctx?.thinkingLevel ?? "?";
			} catch {
				return "?";
			}
		})();

		let ctxLine = "";
		try {
			const cu = ctx?.getContextUsage?.();
			if (cu?.percent != null) {
				ctxLine = `\nContext:      ${Math.round(cu.percent)}% (${fmt(cu.tokens ?? 0)} / ${fmt(cu.contextWindow ?? 0)})`;
			}
		} catch {
			/* best effort */
		}

		const lines = [
			`ℹ️ Harness & session info`,
			`Harness:      ${piVersion || "pi"} · node ${process.version} · uptime ${fmtDuration(process.uptime() * 1000)}${extCount != null ? ` · extensions(settings): ${extCount}` : ""}`,
			"",
			`📁 Workspace`,
			`Directory:    ${shortHome(cwd)}`,
			branch
				? `Git:          ${branch}, ${dirty ? "dirty" : "clean"}, +${added}/-${deleted}${aheadBehind ? `, ahead/behind: ${aheadBehind.replace(/\s+/g, "/")}` : ""}`
				: null,
			"",
			`🤖 Session`,
			`Model:        ${ctx?.model ? `${ctx.model.provider}/${ctx.model.id}` : "—"} · think: ${think}${modelSwitches ? ` · switches: ${modelSwitches}` : ""}`,
			`Elapsed:      ${firstTs !== undefined ? fmtDuration(Date.now() - firstTs) : "—"} wall-clock`,
			`Messages:     ${userMsgs} user · ${assistantMsgs} assistant`,
			compactions ? `Compactions:  ${compactions}` : null,
			"",
			`🔧 Tools & MCP`,
			`MCP servers:  ${mcpServers.length ? mcpServers.join(", ") : "—"}`,
			`Tools:        ${activeTools.size || allTools.length} active / ${allTools.length} registered${mcpTools.length ? ` · MCP tools: ${activeMcpTools.length}/${mcpTools.length}` : ""}`,
			`Tool context: ~${fmt(activeToolCtxTokens)} tokens of system-prompt budget (estimate)`,
			topTools ? `Top used:     ${topTools}` : `Tool calls:   0`,
			`Skills:       ${installedSkills.length} installed${skillsUsed.size ? ` · touched this session: ${[...skillsUsed].join(", ")}` : ""}`,
			"",
			`🧠 Tokens & cost`,
			`Tokens total: ${fmt(totalTokens)}`,
			`  input       ${fmt(input)}`,
			`  cached      ${fmt(cacheRead)} read · ${fmt(cacheWrite)} write`,
			`  output      ${fmt(output)}${reasoning ? ` (+${fmt(reasoning)} reasoning)` : ""}`,
			cacheHitPct !== null ? `Cache hit:    ${cacheHitPct}% (${fmt(cacheRead)} of ${fmt(promptTokens)} prompt tokens)` : null,
			`Cost:         $${cost.toFixed(4)}`,
			ctxLine,
			sessionFileLine,
		]
			.filter((l): l is string => l !== null)
			.join("\n");

		ctx.ui.notify(lines, "info");
	};

	for (const name of ["info", "stats", "statistics", "session-stats"]) {
		api.registerCommand(name, {
			description: "Harness & session info (tools, MCP, skills, tokens, cost)",
			handler,
		});
	}
}
