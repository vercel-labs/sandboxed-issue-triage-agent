import type { ValidatedTriageRequest } from "./types";

export function createTriagePrompt({
  issueUrl,
  repoUrl,
  issueText,
  failingCommand
}: ValidatedTriageRequest & { issueText: string }) {
  return `
Investigate this issue report in an isolated sandbox.

Repository:
${repoUrl}

Issue URL:
${issueUrl}

Issue report:
${issueText}

Failing command to try first:
${failingCommand}

Your task:
1. Clone or inspect the repository.
2. Run the failing command first.
3. If setup is required, choose the smallest safe setup path and explain it.
4. Determine whether the failure reproduces.
5. Return the report using the Reproduction Triage Skill format.

Do not edit files or open a pull request.
`.trim();
}
