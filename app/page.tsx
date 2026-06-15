"use client";

import { Copy, FileText, GitBranch, Play, Square, Terminal } from "lucide-react";
import { useMemo, useState } from "react";
import { createRunId, logTriageDebug, logTriageError } from "@/lib/debug";
import type { HarnessKey } from "@/lib/types";

type TriageStreamEvent =
  | {
      type: "debug" | "error";
      event: string;
      runId: string;
      elapsedMs: number;
      metadata?: Record<string, unknown>;
    }
  | {
      type: "activity";
      text: string;
      runId: string;
      elapsedMs: number;
      metadata?: Record<string, unknown>;
    }
  | { type: "report"; text: string };

const harnessOptions: Array<{
  value: HarnessKey;
  label: string;
  model: string;
}> = [
  { value: "claude-code", label: "Claude Code", model: "claude-sonnet-4.5" },
  { value: "codex", label: "Codex", model: "gpt-5-codex" }
];

const reportSections = [
  "Summary",
  "Reproduction status",
  "Commands run",
  "Error output",
  "Likely cause",
  "Next step",
  "Files worth inspecting"
];

export default function Home() {
  const [issueUrl, setIssueUrl] = useState("");
  const [failingCommand, setFailingCommand] = useState("");
  const [harness, setHarness] = useState<HarnessKey>("claude-code");
  const [report, setReport] = useState("");
  const [debugLogs, setDebugLogs] = useState<string[]>([]);
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">("idle");
  const [status, setStatus] = useState<"idle" | "running" | "done" | "error">("idle");
  const [abortController, setAbortController] = useState<AbortController | null>(null);

  const statusLabel = useMemo(() => {
    if (status === "running") return "Investigating in sandbox";
    if (status === "done") return "Report ready";
    if (status === "error") return "Run blocked";
    return "Ready";
  }, [status]);

  const activeHarness = harnessOptions.find((option) => option.value === harness);

  async function runTriage() {
    const controller = new AbortController();
    const runId = createRunId();
    const startedAt = Date.now();

    logTriageDebug("ui.run.start", {
      runId,
      issueUrl,
      harness,
      failingCommand
    });

    setAbortController(controller);
    setStatus("running");
    setReport("");
    setDebugLogs([]);
    setCopyStatus("idle");

    try {
      logTriageDebug("ui.fetch.start", { runId });
      const response = await fetch("/api/triage", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-triage-run-id": runId },
        body: JSON.stringify({ issueUrl, failingCommand, harness }),
        signal: controller.signal
      });

      logTriageDebug("ui.fetch.response", {
        runId,
        ok: response.ok,
        status: response.status,
        hasBody: Boolean(response.body)
      });

      if (!response.ok || !response.body) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error ?? "The triage route did not return a stream.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let chunks = 0;
      let bytes = 0;
      let pendingLine = "";
      let reportText = "";

      function appendStreamEvent(event: TriageStreamEvent) {
        if (event.type === "report") {
          reportText += event.text;
          setReport((current) => current + event.text);
          return;
        }

        if (event.type === "activity") {
          const metadata =
            event.metadata && Object.keys(event.metadata).length > 0
              ? ` ${JSON.stringify(event.metadata)}`
              : "";

          setDebugLogs((current) => [
            ...current,
            `[${event.elapsedMs}ms] ${event.text}${metadata}`
          ]);
          return;
        }

        const metadata =
          event.metadata && Object.keys(event.metadata).length > 0
            ? ` ${JSON.stringify(event.metadata)}`
            : "";

        setDebugLogs((current) => [
          ...current,
          `[${event.elapsedMs}ms] ${event.event}${metadata}`
        ]);
      }

      function parseStreamText(text: string) {
        pendingLine += text;
        const lines = pendingLine.split("\n");
        pendingLine = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) continue;

          try {
            appendStreamEvent(JSON.parse(line) as TriageStreamEvent);
          } catch {
            reportText += line;
            setReport((current) => current + line);
          }
        }
      }

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks += 1;
        bytes += value.byteLength;
        logTriageDebug("ui.stream.chunk", {
          runId,
          chunk: chunks,
          byteLength: value.byteLength,
          totalBytes: bytes
        });
        parseStreamText(decoder.decode(value, { stream: true }));
      }

      const finalText = decoder.decode();
      if (finalText) {
        parseStreamText(finalText);
      }
      if (pendingLine.trim()) {
        parseStreamText("\n");
      }

      logTriageDebug("ui.stream.complete", {
        runId,
        chunks,
        bytes,
        elapsedMs: Date.now() - startedAt
      });

      if (reportText.trim()) {
        setStatus("done");
      } else {
        const emptyReport =
          "## Summary\n\nThe triage run finished, but no report text was streamed.\n\n## Reproduction status\nblocked\n\n## Suggested next step\nCheck the debug stream for the last server-side event and adapter finish reason.";

        setReport(emptyReport);
        setDebugLogs((current) => [
          ...current,
          `[${Date.now() - startedAt}ms] ui.stream.empty-report`
        ]);
        setStatus("error");
      }
    } catch (error) {
      if ((error as Error).name === "AbortError") {
        logTriageDebug("ui.run.aborted", { runId, elapsedMs: Date.now() - startedAt });
        setDebugLogs((current) => [
          ...current,
          `[${Date.now() - startedAt}ms] ui.run.aborted`
        ]);
        setReport((current) => `${current}\n\nRun stopped by user.`);
        setStatus("idle");
      } else {
        logTriageError("ui.run.failed", error, {
          runId,
          elapsedMs: Date.now() - startedAt
        });
        setDebugLogs((current) => [
          ...current,
          `[${Date.now() - startedAt}ms] ui.run.failed ${
            error instanceof Error ? error.message : "Unknown error"
          }`
        ]);
        setReport(error instanceof Error ? error.message : "Unknown error");
        setStatus("error");
      }
    } finally {
      logTriageDebug("ui.run.finished", { runId, elapsedMs: Date.now() - startedAt });
      setAbortController(null);
    }
  }

  function stopRun() {
    abortController?.abort();
  }

  async function copyReport() {
    if (!report.trim()) {
      return;
    }

    try {
      await navigator.clipboard.writeText(report);
      setCopyStatus("copied");
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = report;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();

      const copied = document.execCommand("copy");
      document.body.removeChild(textarea);

      setCopyStatus(copied ? "copied" : "failed");
    }
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          <span>HarnessAgent</span>
        </div>
        <div className="product-pill">AI SDK 7 · HarnessAgent + Vercel Sandbox</div>
      </header>

      <div className="workspace">
        <section className="masthead" aria-labelledby="page-title">
          <h1 id="page-title">Triage a repro repo, get a maintainer report</h1>
          <p>
            Run an unknown reproduction repository inside an isolated Vercel Sandbox and
            stream back a structured triage report, not a guess.
          </p>
        </section>

        <section className="panel form-panel" aria-label="Triage input form">
          <div className="panel-header">
            <h2>Triage</h2>
            <span>Inputs</span>
          </div>

          <div className="field">
            <label htmlFor="issueUrl">Issue URL</label>
            <div className="input-shell">
              <GitBranch size={17} aria-hidden="true" />
              <input
                className="input"
                id="issueUrl"
                value={issueUrl}
                onChange={(event) => setIssueUrl(event.target.value)}
                placeholder="https://github.com/owner/repo/issues/123"
              />
            </div>
          </div>

          <div className="field">
            <label htmlFor="failingCommand">Failing command</label>
            <div className="input-shell mono-input">
              <Terminal size={17} aria-hidden="true" />
              <input
                className="input"
                id="failingCommand"
                value={failingCommand}
                onChange={(event) => setFailingCommand(event.target.value)}
                placeholder="npm test"
              />
            </div>
          </div>

          <div className="field">
            <label>Harness</label>
            <div className="harness-grid" role="radiogroup" aria-label="Harness adapter">
              {harnessOptions.map((option) => (
                <button
                  aria-checked={harness === option.value}
                  className={`harness-option ${harness === option.value ? "selected" : ""}`}
                  key={option.value}
                  onClick={() => setHarness(option.value)}
                  role="radio"
                  type="button"
                >
                  <span>{option.label}</span>
                  <code>{option.model}</code>
                </button>
              ))}
            </div>
          </div>

          <div className="actions">
            <button
              className="button primary"
              disabled={status === "running"}
              onClick={runTriage}
              type="button"
            >
              <Play size={18} aria-hidden="true" />
              Run triage
            </button>
            <button
              className="button secondary"
              disabled={status !== "running"}
              onClick={stopRun}
              type="button"
              aria-label="Stop run"
            >
              <Square size={18} aria-hidden="true" />
            </button>
          </div>
        </section>

        <section className="panel report-panel" aria-label="Streaming triage report">
          <div className="report-toolbar">
            <div className="status">
              <span className={`status-dot ${status}`} aria-hidden="true" />
              <span>{statusLabel}</span>
            </div>
            <span className="adapter-label">via {activeHarness?.label ?? "Harness"}</span>
            <button
              className="button secondary"
              disabled={!report.trim()}
              onClick={copyReport}
              type="button"
            >
              <Copy size={17} aria-hidden="true" />
              {copyStatus === "copied"
                ? "Copied"
                : copyStatus === "failed"
                  ? "Copy failed"
                  : "Copy report"}
            </button>
          </div>
          <div className={`report-body ${report ? "has-report" : ""}`}>
            {report ? (
              <pre className="report">{report}</pre>
            ) : (
              <div className="empty-report">
                <div className="empty-icon">
                  <FileText size={31} aria-hidden="true" />
                </div>
                <h2>{status === "running" ? "Waiting for report text" : "No report yet"}</h2>
                <p>
                  {status === "running"
                    ? "The sandbox is preparing the run and will stream the maintainer report here."
                    : "Run triage to stream a maintainer report covering:"}
                </p>
                <ol className="section-list">
                  {reportSections.map((section, index) => (
                    <li key={section}>
                      <span>{String(index + 1).padStart(2, "0")}</span>
                      {section}
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </div>
          <details className="debug-panel" open={status === "running" || status === "error"}>
            <summary>
              <span>Diagnostics</span>
              <span>{debugLogs.length} events</span>
            </summary>
            <pre className={`debug-log ${debugLogs.length ? "" : "empty"}`}>
              {debugLogs.length
                ? debugLogs.join("\n")
                : "Debug events from the API stream will appear here."}
            </pre>
          </details>
        </section>
      </div>
    </main>
  );
}
