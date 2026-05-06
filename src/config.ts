import * as core from "@actions/core";
import {
  buildManagedPaths,
  parseBoolean,
  parseCaptureFormat,
  parseInteger,
  parseMarkerName,
  parseWaitUntil,
  resolveWorkspacePath,
  validateNonEmptyInput,
  validateAssetPathForFormat,
  validateUrl,
  type CaptureFormat,
  type WaitUntil
} from "./lib";

export type ActionConfig = {
  url: string;
  capturePath: string;
  captureAbsolutePath: string;
  markdownPath: string;
  markdownAbsolutePath: string;
  markerName: string;
  captureFormat: CaptureFormat;
  viewportWidth: number;
  viewportHeight: number;
  waitUntil: WaitUntil;
  navigationRetries: number;
  navigationRetryDelayMs: number;
  delayMs: number;
  gifDurationMs: number;
  browserPath?: string;
  commitChanges: boolean;
  commitMessage: string;
  commitAuthorName: string;
  commitAuthorEmail: string;
  workspace: string;
  managedPaths: string[];
};

export function parseActionConfig(): ActionConfig {
  const workspace = process.env.GITHUB_WORKSPACE;
  if (!workspace) {
    throw new Error("GITHUB_WORKSPACE is not set.");
  }

  const url = validateUrl(core.getInput("url", { required: true })).toString();
  const capturePath = core.getInput("capture_path", { required: true });
  const markdownPath = core.getInput("markdown_path") || "README.md";
  const markerName = parseMarkerName(core.getInput("marker_name") || "screenshot");
  const captureFormat = parseCaptureFormat(core.getInput("capture_format") || "image");
  const viewportWidth = parseInteger("viewport_width", core.getInput("viewport_width") || "1440");
  const viewportHeight = parseInteger("viewport_height", core.getInput("viewport_height") || "900");
  const waitUntil = parseWaitUntil(core.getInput("wait_until") || "networkidle");
  const navigationRetries = parseInteger("navigation_retries", core.getInput("navigation_retries") || "0");
  const navigationRetryDelayMs = parseInteger(
    "navigation_retry_delay_ms",
    core.getInput("navigation_retry_delay_ms") || "1000"
  );
  const delayMs = parseInteger("delay_ms", core.getInput("delay_ms") || "0");
  const gifDurationMs = parseInteger("gif_duration_ms", core.getInput("gif_duration_ms") || "1000");
  const browserPathInput = core.getInput("browser_path") || undefined;
  const commitChanges = parseBoolean("commit_changes", core.getInput("commit_changes") || "false");
  const commitMessage = validateNonEmptyInput(
    "commit_message",
    core.getInput("commit_message") || "docs: update screenshots"
  );
  const commitAuthorName = validateNonEmptyInput(
    "commit_author_name",
    core.getInput("commit_author_name") || "github-actions[bot]"
  );
  const commitAuthorEmail = validateNonEmptyInput(
    "commit_author_email",
    core.getInput("commit_author_email") || "41898282+github-actions[bot]@users.noreply.github.com"
  );

  validateAssetPathForFormat(capturePath, captureFormat);

  return {
    url,
    capturePath,
    captureAbsolutePath: resolveWorkspacePath(workspace, capturePath),
    markdownPath,
    markdownAbsolutePath: resolveWorkspacePath(workspace, markdownPath),
    markerName,
    captureFormat,
    viewportWidth,
    viewportHeight,
    waitUntil,
    navigationRetries,
    navigationRetryDelayMs,
    delayMs,
    gifDurationMs,
    browserPath: browserPathInput,
    commitChanges,
    commitMessage,
    commitAuthorName,
    commitAuthorEmail,
    workspace,
    managedPaths: buildManagedPaths(capturePath, markdownPath)
  };
}
