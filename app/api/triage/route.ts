import { createTriageAgent } from "@/lib/harness-agent";
import { createTriagePrompt } from "@/lib/prompt";
import { fetchGithubIssueContext } from "@/lib/github";
import {
  createRunId,
  getTriageErrorMetadata,
  logTriageDebug,
  logTriageError,
  sanitizeTriageMetadata
} from "@/lib/debug";
import { validateTriageRequest } from "@/lib/types";
import type { HarnessAgentSession } from "@ai-sdk/harness/agent";

type StreamPart = {
  type?: string;
  text?: string;
  delta?: string;
  error?: unknown;
  toolCallId?: string;
  toolName?: string;
  input?: unknown;
  output?: unknown;
  nativeName?: string;
};

type StreamLogMetadata = Record<string, unknown>;

function createBlockedReport(message: string) {
  return [
    "## Summary",
    "",
    "The triage run could not start or complete.",
    "",
    "## Reproduction status",
    "blocked",
    "",
    "## Relevant error output",
    "```",
    message,
    "```",
    "",
    "## Suggested next step",
    "Check the GitHub issue URL, harness package installation, and Vercel Sandbox credentials."
  ].join("\n");
}

function getStreamPartText(part: StreamPart) {
  return part.text ?? part.delta ?? "";
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function truncate(value: string, maxLength = 220) {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

function summarizeValue(value: unknown) {
  if (typeof value === "undefined") return undefined;
  if (typeof value === "string") return truncate(value);

  try {
    return truncate(JSON.stringify(value));
  } catch {
    return String(value);
  }
}

export async function POST(request: Request) {
  const requestRunId = request.headers.get("x-triage-run-id");
  const runId = requestRunId?.match(/^[a-z0-9-]{8,64}$/i) ? requestRunId : createRunId();
  const startedAt = Date.now();

  logTriageDebug("api.request.received", {
    runId,
    hasRequestRunId: Boolean(requestRunId),
    method: request.method,
    contentType: request.headers.get("content-type")
  });

  const body = await request.json().catch(() => null);
  const validation = validateTriageRequest(body);

  if (!validation.ok) {
    logTriageDebug("api.request.invalid", {
      runId,
      error: validation.error,
      bodyType: body === null ? "null" : typeof body
    });

    return Response.json({ error: validation.error }, { status: 400 });
  }

  logTriageDebug("api.request.valid", {
    runId,
    issueUrl: validation.value.issueUrl,
    repoUrl: validation.value.repoUrl,
    harness: validation.value.harness,
    failingCommand: validation.value.failingCommand,
    issueNumber: validation.value.issueNumber
  });

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let session: HarnessAgentSession | undefined;
      let streamedTextParts = 0;
      let streamedBytes = 0;

      function enqueueEvent(payload: Record<string, unknown>) {
        controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`));
      }

      function streamDebug(event: string, metadata: StreamLogMetadata = {}) {
        logTriageDebug(event, metadata);
        enqueueEvent({
          type: "debug",
          event,
          runId,
          elapsedMs: Date.now() - startedAt,
          metadata: sanitizeTriageMetadata(metadata)
        });
      }

      function streamError(event: string, error: unknown, metadata: StreamLogMetadata = {}) {
        logTriageError(event, error, metadata);
        enqueueEvent({
          type: "error",
          event,
          runId,
          elapsedMs: Date.now() - startedAt,
          metadata: sanitizeTriageMetadata({ ...metadata, ...getTriageErrorMetadata(error) })
        });
      }

      function streamReport(text: string) {
        enqueueEvent({ type: "report", text });
      }

      function streamActivity(text: string, metadata: StreamLogMetadata = {}) {
        enqueueEvent({
          type: "activity",
          text,
          runId,
          elapsedMs: Date.now() - startedAt,
          metadata: sanitizeTriageMetadata(metadata)
        });
      }

      try {
        streamDebug("api.stream.open", {
          hasRequestRunId: Boolean(requestRunId),
          issueUrl: validation.value.issueUrl,
          repoUrl: validation.value.repoUrl,
          harness: validation.value.harness,
          failingCommand: validation.value.failingCommand,
          issueNumber: validation.value.issueNumber
        });

        streamDebug("api.issue.fetch.start", {
          owner: validation.value.owner,
          repo: validation.value.repo,
          issueNumber: validation.value.issueNumber
        });
        const issueText = await fetchGithubIssueContext(validation.value);
        streamDebug("api.issue.fetch.complete", {
          issueTextLength: issueText.length
        });

        streamDebug("api.agent.create.start", { harness: validation.value.harness });
        const agent = await createTriageAgent(validation.value.harness);
        streamDebug("api.agent.create.complete");

        streamDebug("api.session.create.start");
        session = await agent.createSession();
        streamDebug("api.session.create.complete");

        const prompt = createTriagePrompt({ ...validation.value, issueText });
        streamDebug("api.agent.stream.start", {
          promptLength: prompt.length
        });
        const result = await agent.stream({
          session,
          prompt
        });

        for await (const part of result.fullStream as AsyncIterable<StreamPart>) {
          const text = getStreamPartText(part);

          streamDebug("api.agent.stream.part", {
            type: part.type,
            textLength: text.length,
            hasError: part.type === "error" && typeof part.error !== "undefined",
            toolName: part.toolName ?? part.nativeName,
            toolCallId: part.toolCallId,
            input: summarizeValue(part.input),
            output: summarizeValue(part.output)
          });

          if (part.type === "text-delta" && text) {
            streamedTextParts += 1;
            streamedBytes += text.length;
            streamReport(text);
          }

          if (part.type === "error") {
            const message = getErrorMessage(part.error ?? "Unknown harness stream error");
            streamError("api.agent.stream.error-part", part.error ?? message, {
              streamedTextParts,
              streamedBytes
            });
            streamReport(createBlockedReport(message));
            streamedTextParts += 1;
            streamedBytes += message.length;
          }

          if (part.type === "tool-call") {
            const toolName = part.toolName ?? part.nativeName ?? "tool";
            streamActivity(`Calling ${toolName}`, {
              toolName,
              toolCallId: part.toolCallId,
              input: summarizeValue(part.input)
            });
          }

          if (part.type === "tool-result") {
            const toolName = part.toolName ?? part.nativeName ?? "tool";
            streamActivity(`Completed ${toolName}`, {
              toolName,
              toolCallId: part.toolCallId,
              output: summarizeValue(part.output)
            });
          }
        }

        if (streamedBytes === 0) {
          const finalText = await Promise.resolve(result.text).catch(() => "");

          if (finalText.trim()) {
            streamedTextParts += 1;
            streamedBytes += finalText.length;
            streamDebug("api.agent.stream.final-text-recovered", {
              textLength: finalText.length
            });
            streamReport(finalText);
          } else {
            const message =
              "The harness completed without streaming any report text. Check the debug log for stream part types and adapter setup.";
            streamDebug("api.agent.stream.empty-report");
            streamReport(createBlockedReport(message));
          }
        }

        streamDebug("api.agent.stream.complete", {
          streamedTextParts,
          streamedBytes
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        streamError("api.agent.run.failed", error, {
          streamedTextParts,
          streamedBytes
        });

        streamReport(createBlockedReport(message));
      } finally {
        if (session) {
          streamDebug("api.session.destroy.start");
          await session
            .destroy()
            .then(() => {
              streamDebug("api.session.destroy.complete");
            })
            .catch((error) => {
              streamError("api.session.destroy.failed", error);
            });
        }
        streamDebug("api.response.close");
        controller.close();
      }
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform"
    }
  });
}
