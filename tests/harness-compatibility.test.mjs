import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { HarnessAgent } from "@ai-sdk/harness/agent";
import { createClaudeCode } from "@ai-sdk/harness-claude-code";
import { createCodex } from "@ai-sdk/harness-codex";
import { createVercelSandbox } from "@ai-sdk/sandbox-vercel";
import { getGatewayAuthentication } from "../lib/harness-auth.ts";

const require = createRequire(import.meta.url);
const harnessRequire = createRequire(require.resolve("@ai-sdk/harness"));
const { asSchema } = await import(harnessRequire.resolve("@ai-sdk/provider-utils"));

const adapters = [
  createClaudeCode({
    auth: getGatewayAuthentication({ AI_GATEWAY_API_KEY: "fixture-only" }),
  }),
  createCodex({
    auth: getGatewayAuthentication({ AI_GATEWAY_API_KEY: "fixture-only" }),
  }),
];

for (const adapter of adapters) {
  test(`${adapter.harnessId} constructs with Zod 4 tool schemas and sandbox settings`, async () => {
    const sandbox = createVercelSandbox({ runtime: "node24", ports: [3000] });
    const agent = new HarnessAgent({
      harness: adapter,
      model: adapter.harnessId === "claude-code" ? "claude-sonnet-4.5" : "gpt-5-codex",
      sandbox,
      instructions: "Inspect the reproduction repository.",
      tools: {},
      skills: [{ name: "triage", description: "Inspect", content: "Read only." }],
    });
    assert.equal(agent.harnessId, adapter.harnessId);
    assert.equal(sandbox.specificationVersion, "harness-sandbox-v1");
    assert.ok(Object.keys(agent.tools).length > 0);
    for (const tool of Object.values(agent.tools)) {
      const schema = asSchema(tool.inputSchema);
      assert.ok(["object", "string"].includes((await schema.jsonSchema).type));
      assert.equal((await schema.validate(null)).success, false);
    }
    const recipe = await adapter.getBootstrap();
    assert.ok(recipe.files.some((file) => file.path.endsWith("package.json")));
    assert.ok(recipe.commands.some(({ command }) => command.includes("install")));
  });

  test(`${adapter.harnessId} rejects unavailable bridge ports before sandbox commands`, async () => {
    const unexpected = () => { throw new Error("Unexpected sandbox I/O"); };
    await assert.rejects(adapter.doStart({
      sessionId: "fixture",
      sessionWorkDir: "/workspace/fixture",
      sandboxSession: {
        id: "fixture", defaultWorkingDirectory: "/workspace", ports: [],
        restricted: () => ({ run: unexpected, spawn: unexpected }),
      },
    }), /port/i);
  });
}

test("the stable agent preserves streaming, structured tool results and cleanup", async () => {
  let sandboxDestroyed = 0;
  let adapterDestroyed = 0;
  const sandbox = {
    id: "fixture", defaultWorkingDirectory: "/workspace", ports: [3000],
    run: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
    restricted() { return this; },
    stop: async () => {},
    destroy: async () => { sandboxDestroyed++; },
  };
  const harness = {
    specificationVersion: "harness-v1", harnessId: "fixture",
    builtinTools: { read: adapters[0].builtinTools.read },
    doStart: async ({ sessionId }) => ({
      sessionId,
      doPromptTurn: async ({ emit, instructions, model }) => {
        assert.equal(instructions, "Fixture instructions");
        assert.equal(model, "fixture-model");
        emit({ type: "text-start", id: "text" });
        emit({ type: "text-delta", id: "text", delta: "Reproduced." });
        emit({ type: "text-end", id: "text" });
        emit({ type: "tool-call", toolCallId: "call", toolName: "read",
          input: '{"file_path":"/workspace/file.ts"}', providerExecuted: true });
        emit({ type: "tool-result", toolCallId: "call", toolName: "read",
          result: { text: "fixture source" }, providerExecuted: true });
        emit({ type: "finish-step", finishReason: { unified: "stop", raw: "stop" },
          usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } } });
        emit({ type: "finish", finishReason: { unified: "stop", raw: "stop" },
          totalUsage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } } });
        return { submitToolResult: async () => {}, done: Promise.resolve() };
      },
      doDestroy: async () => { adapterDestroyed++; },
    }),
  };
  const agent = new HarnessAgent({ harness, instructions: "Fixture instructions", model: "fixture-model",
    sandbox: { specificationVersion: "harness-sandbox-v1", providerId: "fixture",
      createSession: async () => sandbox } });
  const session = await agent.createSession();
  try {
    const result = await agent.stream({ session, prompt: "Inspect" });
    const parts = [];
    for await (const part of result.fullStream) parts.push(part);
    assert.equal(await result.text, "Reproduced.");
    assert.ok(parts.some((part) => part.type === "tool-result"));
    assert.ok(parts.some((part) => part.type === "text-delta" && part.text === "Reproduced."));
  } finally {
    await session.destroy();
  }
  assert.equal(adapterDestroyed, 1);
  assert.equal(sandboxDestroyed, 1);
});

test("gateway authentication preserves explicit keys, OIDC fallback and custom URLs only", () => {
  assert.deepEqual(getGatewayAuthentication({
    AI_GATEWAY_API_KEY: "gateway-fixture", VERCEL_OIDC_TOKEN: "oidc-fixture",
    AI_GATEWAY_BASE_URL: "https://gateway.example/v1", OPENAI_API_KEY: "excluded",
    ANTHROPIC_API_KEY: "excluded",
  }), { AI_GATEWAY_API_KEY: "gateway-fixture", AI_GATEWAY_BASE_URL: "https://gateway.example/v1" });
  assert.deepEqual(getGatewayAuthentication({ VERCEL_OIDC_TOKEN: "oidc-fixture" }),
    { AI_GATEWAY_API_KEY: "oidc-fixture" });
  assert.deepEqual(getGatewayAuthentication({ OPENAI_API_KEY: "excluded" }), {});
});

test("the stable agent reports a sandbox startup error without starting an adapter", async () => {
  let started = false;
  const agent = new HarnessAgent({
    harness: { specificationVersion: "harness-v1", harnessId: "fixture", builtinTools: {},
      doStart: async () => { started = true; } },
    sandbox: { specificationVersion: "harness-sandbox-v1", providerId: "fixture",
      createSession: async () => { throw new Error("Sandbox fixture unavailable"); } },
  });
  await assert.rejects(agent.createSession(), /Sandbox fixture unavailable/);
  assert.equal(started, false);
});
