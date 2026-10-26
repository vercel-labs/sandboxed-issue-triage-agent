import assert from "node:assert/strict";
import test from "node:test";
import { prepareSandboxForHarness } from "@ai-sdk/harness/agent";
import { createClaudeCode } from "@ai-sdk/harness-claude-code";

const adapter = createClaudeCode({ auth: {} });

test("the emitted Claude bootstrap installs the patched sandbox dependency graph", async () => {
  const recipe = await adapter.getBootstrap();
  const asset = (name) => recipe.files.find((file) => file.path.endsWith(`/${name}`)).content;
  const manifest = JSON.parse(asset("package.json"));
  assert.equal(manifest.dependencies.zod, "4.6.7");
  assert.equal(manifest.packageManager, "pnpm@10.34.5");
  const packages = asset("pnpm-lock.yaml").split("\npackages:\n")[1].split("\nsnapshots:\n")[0];
  for (const [name, oldVersion, fixedVersion] of [
    ["body-parser", "2.3.0", "2.4.0"],
    ["fast-uri", "3.1.8", "3.1.9"],
    ["hono", "4.13.8", "4.13.11"],
    ["ip-address", "10.7.2", "10.7.4"],
    ["zod", "4.4.3", "4.6.7"],
  ]) {
    assert.ok(packages.includes(`\n  ${name}@${fixedVersion}:`), `${name} must be patched in the sandbox`);
    assert.ok(!packages.includes(`\n  ${name}@${oldVersion}:`), `${name} must not retain its vulnerable sandbox copy`);
  }
  assert.ok(recipe.commands.some(({ command }) => command.includes("install --frozen-lockfile")));
});

test("a changed sandbox lock invalidates the SDK bootstrap identity and cached marker", async () => {
  const files = new Map();
  let installs = 0;
  const session = {
    readTextFile: async ({ path }) => files.get(path) ?? null,
    writeTextFile: async ({ path, content }) => { files.set(path, content); },
    run: async ({ command }) => {
      if (command.startsWith("pnpm install")) installs++;
      return { exitCode: 0, stdout: command.includes("$HOME") ? "/fixture" : "", stderr: "" };
    },
  };
  const recipe = await adapter.getBootstrap();
  const previous = {
    ...adapter,
    getBootstrap: async () => ({
      ...recipe,
      files: recipe.files.map((file) => file.path.endsWith("/pnpm-lock.yaml")
        ? { ...file, content: `${file.content}\n# previous snapshot\n` }
        : file),
    }),
  };
  const before = await prepareSandboxForHarness({ session, harnesses: [previous] });
  const after = await prepareSandboxForHarness({ session, harnesses: [adapter] });
  const cached = await prepareSandboxForHarness({ session, harnesses: [adapter] });
  assert.notEqual(before.identity, after.identity);
  assert.equal(after.identity, cached.identity);
  assert.equal(installs, 2);
});
