import type { ValidatedTriageRequest } from "./types";

type GitHubIssueResponse = {
  title?: string;
  body?: string | null;
  state?: string;
  user?: { login?: string };
  html_url?: string;
  comments?: number;
  comments_url?: string;
  pull_request?: unknown;
};

type GitHubCommentResponse = {
  body?: string | null;
  user?: { login?: string };
  html_url?: string;
};

const MAX_BODY_CHARS = 12_000;
const MAX_COMMENT_CHARS = 2_000;
const MAX_COMMENTS = 10;

function truncate(value: string, maxLength: number) {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength)}\n\n[truncated ${value.length - maxLength} chars]`;
}

async function fetchGithubJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "sandboxed-issue-triage-agent"
    }
  });

  if (!response.ok) {
    throw new Error(
      `GitHub API request failed (${response.status} ${response.statusText}) for ${url}`
    );
  }

  return (await response.json()) as T;
}

export async function fetchGithubIssueContext(issue: ValidatedTriageRequest) {
  const apiUrl = `https://api.github.com/repos/${issue.owner}/${issue.repo}/issues/${issue.issueNumber}`;
  const issueResponse = await fetchGithubJson<GitHubIssueResponse>(apiUrl);

  if (issueResponse.pull_request) {
    throw new Error("The provided URL is a pull request, not a GitHub issue.");
  }

  const commentsCount = issueResponse.comments ?? 0;
  const commentsUrl =
    issueResponse.comments_url ??
    `${apiUrl}/comments?per_page=${MAX_COMMENTS}`;
  const comments =
    commentsCount > 0
      ? await fetchGithubJson<GitHubCommentResponse[]>(
          `${commentsUrl}${commentsUrl.includes("?") ? "&" : "?"}per_page=${MAX_COMMENTS}`
        )
      : [];

  return [
    `Title: ${issueResponse.title ?? "(untitled)"}`,
    `State: ${issueResponse.state ?? "unknown"}`,
    `Author: ${issueResponse.user?.login ?? "unknown"}`,
    `URL: ${issueResponse.html_url ?? issue.issueUrl}`,
    "",
    "Body:",
    truncate(issueResponse.body?.trim() || "(no body)", MAX_BODY_CHARS),
    "",
    "Comments:",
    comments.length
      ? comments
          .map((comment, index) =>
            [
              `Comment ${index + 1} by ${comment.user?.login ?? "unknown"}:`,
              truncate(comment.body?.trim() || "(no body)", MAX_COMMENT_CHARS),
              comment.html_url ? `URL: ${comment.html_url}` : ""
            ]
              .filter(Boolean)
              .join("\n")
          )
          .join("\n\n")
      : "(no comments fetched)"
  ].join("\n");
}
