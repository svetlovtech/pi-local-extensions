// session-stats — /stats (alias /statistics, /session-stats) command for Pi.
//
// Prints the full picture that no longer fits in the compact footer:
// paths + git, model/provider/thinking, wall-clock vs active time,
// token breakdown (input / cache read+write / output / reasoning),
// cost, message & tool-call counts, and context-window usage.
import { execSync } from "node:child_process";
import { homedir } from "node:os";

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
	timestamp?: string;
	message?: {
		role?: string;
		usage?: UsageLike;
		modelId?: string;
		provider?: string;
	};
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
	return h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${sec}s` : `${sec}s`;
}

function git(args: string, cwd: string): string | null {
	try {
		return execSync(`git ${args}`, { cwd, stdio: ["ignore", "pipe", "ignore"] })
			.toString()
			.trim();
	} catch {
		return null;
	}
}

export default function sessionStats(pi: unknown) {
	const api = pi as {
		registerCommand: (
			name: string,
			opts: { description: string; handler: (args: string, ctx: any) => void },
		) => void;
	};

	const handler = (_args: string, ctx: any) => {
		const cwd = ctx?.cwd ?? process.cwd();
		const entries: EntryLike[] = ctx?.sessionManager?.getBranch?.() ?? [];

		let input = 0;
		let output = 0;
		let cacheRead = 0;
		let cacheWrite = 0;
		let reasoning = 0;
		let cost = 0;
		let assistantMsgs = 0;
		let userMsgs = 0;
		let toolCalls = 0;
		let firstTs: number | undefined;

		for (const entry of entries) {
			if (entry.timestamp && firstTs === undefined) firstTs = Date.parse(entry.timestamp);
			const msg = entry.message;
			if (!msg) continue;
			if (msg.role === "user") userMsgs++;
			if (msg.role === "toolResult") toolCalls++;
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
		}

		const totalTokens = input + output + cacheRead + cacheWrite + reasoning;
		const elapsed = firstTs !== undefined ? fmtDuration(Date.now() - firstTs) : "—";

		// Context-window usage from the host when available.
		let ctxLine = "";
		try {
			const cu = ctx.getContextUsage?.();
			if (cu?.percent != null) {
				ctxLine = `\nContext:      ${Math.round(cu.percent)}% (${fmt(cu.tokens ?? 0)} / ${fmt(cu.contextWindow ?? 0)})`;
			}
		} catch {
			/* best effort */
		}

		const home = homedir();
		const shortCwd = cwd.startsWith(home) ? `~${cwd.slice(home.length)}` : cwd;
		const branch = git("rev-parse --abbrev-ref HEAD", cwd);
		const dirty = git("status --porcelain", cwd);
		const model = ctx?.model ? `${ctx.model.provider ? `${ctx.model.provider}/` : ""}${ctx.model.id}` : "—";

		const lines = [
			`📊 Session statistics`,
			"",
			`Directory:    ${shortCwd}`,
			branch ? `Git:          ${branch}${dirty ? " (dirty)" : " (clean)"}` : null,
			`Model:        ${model} · think: ${api_think(ctx)}`,
			`Elapsed:      ${elapsed} wall-clock`,
			"",
			`Messages:     ${userMsgs} user · ${assistantMsgs} assistant · ${toolCalls} tool calls`,
			`Tokens total: ${fmt(totalTokens)}`,
			`  input       ${fmt(input)}`,
			`  cached      ${fmt(cacheRead)} read · ${fmt(cacheWrite)} write`,
			`  output      ${fmt(output)}${reasoning ? ` (+${fmt(reasoning)} reasoning)` : ""}`,
			`Cost:         $${cost.toFixed(4)}`,
			ctxLine,
		].filter((l): l is string => l !== null);

		ctx.ui.notify(lines.join("\n"), "info");
	};

	function api_think(ctx: any): string {
		try {
			return ctx?.thinkingLevel ?? "?";
		} catch {
			return "?";
		}
	}

	for (const name of ["stats", "statistics", "session-stats"]) {
		api.registerCommand(name, {
			description: "Full session statistics (paths, tokens, cost, time)",
			handler,
		});
	}
}
