/**
 * Custom Providers Extension
 * 
 * Registers:
 * - opencode-go: Opencode GO API (https://api.opencode.com/v1)
 * - gonka: Gonka Router API (https://api.gonkarouter.io/v1)
 * 
 * Usage:
 *   pi -e ~/.pi/agent/extensions/pi-custom-providers/index.ts
 * 
 * With API key:
 *   OPENCODE_GO_API_KEY=sk-... pi -e ~/.pi/agent/extensions/pi-custom-providers/index.ts
 *   GONKA_API_KEY=sk-... pi -e ~/.pi/agent/extensions/pi-custom-providers/index.ts
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  // Gonka Provider
  pi.registerProvider("gonka", {
    name: "Gonka",
    baseUrl: "https://api.gonkarouter.io/v1",
    apiKey: "$GONKA_API_KEY",
    api: "openai-completions",
    models: [
      {
        id: "deepseek-ai/DeepSeek-V4-Flash-0731",
        name: "DeepSeek V4 Flash",
        reasoning: true,
        input: ["text", "image"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 262144,
        maxTokens: 8192,
      },
    ],
  });
}