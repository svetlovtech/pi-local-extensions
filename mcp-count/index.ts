import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const STATUS_KEY = "mcp-count";

function getMcpEnabledCount(): number {
  try {
    const mcpPath = join(homedir(), ".pi", "agent", "mcp.json");
    const data = JSON.parse(readFileSync(mcpPath, "utf-8")) as {
      mcpServers?: Record<string, { disabled?: boolean } | unknown>;
    };
    const servers = data.mcpServers;
    if (!servers || typeof servers !== "object") return 0;
    let count = 0;
    for (const definition of Object.values(servers)) {
      if (
        definition &&
        typeof definition === "object" &&
        (definition as { disabled?: boolean }).disabled !== true
      ) {
        count++;
      }
    }
    return count;
  } catch {
    return 0;
  }
}

export default function mcpCountExtension(pi: unknown) {
  const api = pi as {
    on: (event: string, handler: (event: unknown, ctx: { ui: { setStatus: (key: string, value: string | undefined) => void } }) => Promise<void>) => void;
  };

  api.on("session_start", async (_event, ctx) => {
    const count = getMcpEnabledCount();
    ctx.ui.setStatus(STATUS_KEY, `MCP: ${count}`);
  });
}
