export type HarnessKey = "claude-code" | "codex";

export type TriageRequest = {
  issueUrl: string;
  failingCommand?: string;
  harness?: HarnessKey;
};

export type ValidatedTriageRequest = Required<TriageRequest> & {
  owner: string;
  repo: string;
  issueNumber: number;
  repoUrl: string;
};

export type TriageValidationResult =
  | { ok: true; value: ValidatedTriageRequest }
  | { ok: false; error: string };

const harnesses = new Set<HarnessKey>(["claude-code", "codex"]);

export function validateTriageRequest(input: unknown): TriageValidationResult {
  if (!input || typeof input !== "object") {
    return { ok: false, error: "Expected a JSON request body." };
  }

  const body = input as Partial<TriageRequest>;
  const issueUrl = typeof body.issueUrl === "string" ? body.issueUrl.trim() : "";
  const failingCommand =
    typeof body.failingCommand === "string" && body.failingCommand.trim()
      ? body.failingCommand.trim()
      : "npm test";
  const harness =
    typeof body.harness === "string" && harnesses.has(body.harness as HarnessKey)
      ? (body.harness as HarnessKey)
      : "claude-code";

  if (!issueUrl) {
    return { ok: false, error: "Enter a public GitHub issue URL." };
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(issueUrl);
  } catch {
    return { ok: false, error: "The issue URL is not a valid URL." };
  }

  if (parsedUrl.protocol !== "https:" || parsedUrl.hostname !== "github.com") {
    return {
      ok: false,
      error: "Use an https://github.com/{owner}/{repo}/issues/{number} issue URL."
    };
  }

  const [owner, repo, issueSegment, issueNumberSegment] = parsedUrl.pathname
    .split("/")
    .filter(Boolean);
  const issueNumber = Number(issueNumberSegment);

  if (
    parsedUrl.pathname.split("/").filter(Boolean).length !== 4 ||
    !owner ||
    !repo ||
    issueSegment !== "issues" ||
    !Number.isInteger(issueNumber) ||
    issueNumber < 1
  ) {
    return {
      ok: false,
      error: "Use an https://github.com/{owner}/{repo}/issues/{number} issue URL."
    };
  }

  const repoUrl = `https://github.com/${owner}/${repo}`;

  return {
    ok: true,
    value: {
      issueUrl,
      repoUrl,
      owner,
      repo,
      issueNumber,
      failingCommand,
      harness
    }
  };
}
