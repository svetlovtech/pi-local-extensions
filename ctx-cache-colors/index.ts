import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const CTX_STATUS_KEY = "ctx";
const CACHE_STATUS_KEY = "cache";

// ANSI 256 foreground codes, tuned for dark themes:
// green (#00d700) / light green (#87ff87) / yellow (#ffd700) / orange (#ff8700) / red (#ff0000)
const GREEN = 40;
const LIGHT_GREEN = 120;
const YELLOW = 220;
const ORANGE = 208;
const RED = 196;

// Shared risk scale. ctx uses the fill percent directly (higher = worse),
// cache uses the inverse (100 - hit rate), so both map to "the redder, the worse".
//
// Common thresholds found in pi's built-in footer, ccstatusline and CC-StatusLine:
// 50% = attention, 70% = warning, 90% = danger.
const RISK_ZONES = [
  { min: 90, code: RED },
  { min: 80, code: ORANGE },
  { min: 70, code: YELLOW },
  { min: 50, code: LIGHT_GREEN },
  { min: 0, code: GREEN },
] as const;

function colorForRisk(riskPercent: number): number {
  for (const zone of RISK_ZONES) {
    if (riskPercent >= zone.min) return zone.code;
  }
  return GREEN;
}

function paint(value: string, code: number): string {
  return `\x1b[38;5;${code}m${value}\x1b[39m`;
}

// Loose structural projection of a pi session message entry (from
// sessionManager.getBranch()), same defensive shape as pi-footer's metrics.
interface MessageLike {
  role?: unknown;
  usage?: unknown;
}

interface CacheMetrics {
  cacheRead: number;
  promptTokens: number;
  hasUsage: boolean;
}

function collectCacheMetrics(entries: readonly unknown[]): CacheMetrics {
  const metrics: CacheMetrics = { cacheRead: 0, promptTokens: 0, hasUsage: false };
  for (const entry of entries) {
    if (!isRecord(entry)) continue;
    const message = entry.message;
    if (!isRecord(message) || message.role !== "assistant") continue;
    const usage = message.usage;
    if (!isRecord(usage)) continue;
    metrics.hasUsage = true;
    metrics.cacheRead += numberOrZero(usage.cacheRead);
    metrics.promptTokens +=
      numberOrZero(usage.input) + numberOrZero(usage.cacheRead) + numberOrZero(usage.cacheWrite);
  }
  return metrics;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function numberOrZero(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function update(ctx: ExtensionContext): void {
  // Context fill percent.
  const usage = ctx.getContextUsage();
  let ctxPercent: number | undefined;
  if (usage) {
    if (typeof usage.percent === "number" && Number.isFinite(usage.percent)) {
      ctxPercent = usage.percent;
    } else if (typeof usage.tokens === "number" && usage.contextWindow > 0) {
      ctxPercent = (usage.tokens / usage.contextWindow) * 100;
    }
  }
  if (ctxPercent === undefined) {
    ctx.ui.setStatus(CTX_STATUS_KEY, undefined);
  } else {
    const clamped = Math.min(100, Math.max(0, ctxPercent));
    ctx.ui.setStatus(CTX_STATUS_KEY, paint(`${clamped.toFixed(0)}%`, colorForRisk(clamped)));
  }

  // Cache hit rate across the session (higher = better, so risk is inverted).
  const metrics = collectCacheMetrics(ctx.sessionManager.getBranch());
  if (!metrics.hasUsage || metrics.promptTokens <= 0) {
    ctx.ui.setStatus(CACHE_STATUS_KEY, undefined);
  } else {
    const hitRate = (metrics.cacheRead / metrics.promptTokens) * 100;
    ctx.ui.setStatus(CACHE_STATUS_KEY, paint(`${hitRate.toFixed(0)}%`, colorForRisk(100 - hitRate)));
  }
}

export default function ctxCacheColorsExtension(pi: ExtensionAPI): void {
  // Narrow signature so we can subscribe to several events with one handler.
  const api = pi as unknown as {
    on: (
      event: string,
      handler: (event: unknown, ctx: ExtensionContext) => Promise<void>,
    ) => void;
  };

  for (const event of [
    "session_start",
    "context",
    "message_end",
    "turn_end",
    "session_compact",
    "model_select",
  ]) {
    api.on(event, async (_event, ctx) => update(ctx));
  }

  api.on("session_shutdown", async (_event, ctx) => {
    ctx.ui.setStatus(CTX_STATUS_KEY, undefined);
    ctx.ui.setStatus(CACHE_STATUS_KEY, undefined);
  });
}
