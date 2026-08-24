import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const STATUS_KEY = "active-time";
const ENTRY_TYPE = "active-time";
const UPDATE_INTERVAL_MS = 1000;

// Аккумулированное время реальной работы агента по завершённым запускам
let totalMs = 0;
// Время начала текущего запуска (agent_start ... agent_end)
let runStartMs: number | undefined;
let ticker: ReturnType<typeof setInterval> | undefined;

function currentTotalMs(): number {
	return totalMs + (runStartMs !== undefined ? Date.now() - runStartMs : 0);
}

function pad2(value: number): string {
	return value.toString().padStart(2, "0");
}

function formatElapsed(ms: number): string {
	const totalSeconds = Math.max(0, ms / 1000);

	if (totalSeconds < 10) {
		return `${totalSeconds.toFixed(1)}s`;
	}

	const roundedSeconds = Math.floor(totalSeconds);
	const seconds = roundedSeconds % 60;
	const totalMinutes = Math.floor(roundedSeconds / 60);
	const minutes = totalMinutes % 60;
	const hours = Math.floor(totalMinutes / 60);

	if (hours > 0) {
		return `${hours}h ${pad2(minutes)}m ${pad2(seconds)}s`;
	}

	if (minutes > 0) {
		return `${minutes}m ${pad2(seconds)}s`;
	}

	return `${roundedSeconds}s`;
}

function render(ctx: ExtensionContext): void {
	const ms = currentTotalMs();
	if (ms <= 0) {
		ctx.ui.setStatus(STATUS_KEY, undefined);
		return;
	}
	// raw-статус для pi-footer: красим сами через тему
	const theme = ctx.ui.theme;
	ctx.ui.setStatus(STATUS_KEY, theme.fg("dim", "act ") + theme.fg("success", formatElapsed(ms)));
}

function startTicker(ctx: ExtensionContext): void {
	stopTicker();
	ticker = setInterval(() => render(ctx), UPDATE_INTERVAL_MS);
}

function stopTicker(): void {
	if (ticker !== undefined) {
		clearInterval(ticker);
		ticker = undefined;
	}
}

function startRun(ctx: ExtensionContext): void {
	if (runStartMs !== undefined) return;
	runStartMs = Date.now();
	startTicker(ctx);
	render(ctx);
}

function endRun(pi: ExtensionAPI, ctx: ExtensionContext): void {
	if (runStartMs === undefined) return;
	totalMs += Date.now() - runStartMs;
	runStartMs = undefined;
	stopTicker();
	render(ctx);
	try {
		pi.appendEntry(ENTRY_TYPE, { totalMs });
	} catch {
		// сессия может не поддерживать appendEntry — не критично
	}
}

export default function activeTimeExtension(pi: ExtensionAPI): void {
	pi.on("session_start", async (_event, ctx) => {
		// Восстанавливаем аккумулированное время из последней записи в текущей ветке сессии
		for (const entry of ctx.sessionManager.getBranch()) {
			const e = entry as { type?: unknown; customType?: unknown; data?: unknown };
			if (e.type === "custom" && e.customType === ENTRY_TYPE) {
				const data = e.data as { totalMs?: unknown } | undefined;
				if (data && typeof data.totalMs === "number" && Number.isFinite(data.totalMs)) {
					totalMs = data.totalMs;
				}
			}
		}
		render(ctx);
	});

	pi.on("agent_start", async (_event, ctx) => startRun(ctx));

	// agent_end может завершаться серией ретраев/продолжений — каждый отрезок суммируется,
	// следующий agent_start начнёт новый отрезок
	pi.on("agent_end", async (_event, ctx) => endRun(pi, ctx));

	pi.on("session_shutdown", async (_event, ctx) => {
		stopTicker();
		runStartMs = undefined;
		ctx.ui.setStatus(STATUS_KEY, undefined);
	});
}
