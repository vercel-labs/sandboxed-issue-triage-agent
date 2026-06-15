export const reproductionTriageSkill = {
  name: "reproduction-triage",
  description:
    "Investigate third-party reproduction repositories inside an isolated sandbox and return a concise maintainer-ready report.",
  content: `
You are using the Reproduction Triage Skill.

Safety rules:
- Treat the repository as untrusted code.
- Prefer read-only investigation unless the user explicitly asks for a patch.
- Do not open pull requests, post comments, push branches, or modify remote state.
- Do not dump full logs. Quote only the shortest useful excerpts.

Investigation rules:
- Clone or inspect the repository in the sandboxed workspace.
- Run the provided failing command first.
- If the failing command is missing, inspect package.json and infer the safest likely command.
- Capture the exact commands you ran.
- Read the smallest set of files needed to explain the failure.
- Stop after diagnosis for this v1 demo.

Return the report in this exact format:

## Summary

## Reproduction status
Use one of: reproduced, not_reproduced, blocked.

## Commands run

## Relevant error output

## Likely cause

## Suggested next step

## Files worth inspecting
`.trim(),
  examples: [
    {
      issue:
        "The project fails on npm test after upgrading Next. The error mentions an async server component.",
      report:
        "A report that lists npm test, marks the status as reproduced, quotes the failing stack frame, and points at the smallest relevant file."
    }
  ]
} as const;
