import { HarnessAgent } from "@ai-sdk/harness/agent";
import { createClaudeCode } from "@ai-sdk/harness-claude-code";
import { createCodex } from "@ai-sdk/harness-codex";
import { createVercelSandbox } from "@ai-sdk/sandbox-vercel";
import { logTriageDebug } from "./debug";
import { reproductionTriageSkill } from "./reproduction-triage-skill";
import type { HarnessKey } from "./types";

function getGatewayAuth() {
  return {
    apiKey: process.env.AI_GATEWAY_API_KEY ?? process.env.VERCEL_OIDC_TOKEN,
    baseUrl: process.env.AI_GATEWAY_BASE_URL
  };
}

function resolveHarnessAdapter(harness: HarnessKey) {
  const gateway = getGatewayAuth();

  if (harness === "claude-code") {
    return createClaudeCode({
      auth: { gateway },
      model: "claude-sonnet-4.5"
    });
  }

  return createCodex({
    auth: { gateway },
    model: "gpt-5-codex"
  });
}

export async function createTriageAgent(harness: HarnessKey) {
  logTriageDebug("harness.create-agent.start", {
    harness,
    gatewayAuth: process.env.AI_GATEWAY_API_KEY
      ? "AI_GATEWAY_API_KEY"
      : process.env.VERCEL_OIDC_TOKEN
        ? "VERCEL_OIDC_TOKEN"
        : "missing",
    sandboxRuntime: "node24",
    sandboxPorts: [3000],
    skillNames: [reproductionTriageSkill.name]
  });

  const adapter = resolveHarnessAdapter(harness);

  const agent = new HarnessAgent({
    harness: adapter,
    sandbox: createVercelSandbox({
      runtime: "node24",
      ports: [3000]
    }),
    instructions:
      "You are a maintainer assistant that safely investigates bug reproduction repositories for issue triage.",
    tools: {},
    skills: [reproductionTriageSkill]
  });

  logTriageDebug("harness.create-agent.complete", { harness });

  return agent;
}
