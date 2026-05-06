import * as core from "@actions/core";
import {
  parseBooleanInput,
  parseCaptureFormat,
  parseInteger,
  parseMarkerName,
  parseWaitUntil,
  resolveWorkspacePath,
  validateAssetPathForFormat,
  validateUrl,
  type CaptureFormat,
  type WaitUntil
} from "./lib";

export type ActionConfig = {
  workspace: string;
  url: string;
  assetPath: string;
  assetAbsolutePath: string;
  readmePath: string;
  readmeAbsolutePath: string;
  markerName: string;
  shouldPush: boolean;
  captureFormat: CaptureFormat;
  viewportWidth: number;
  viewportHeight: number;
  waitUntil: WaitUntil;
  navigationRetries: number;
  navigationRetryDelayMs: number;
  delayMs: number;
  gifDurationMs: number;
  browserPath?: string;
  commitMessage: string;
  gitUserName: string;
  gitUserEmail: string;
  targetBranch?: string;
  token?: string;
};

export function parseActionConfig(): ActionConfig {
  const workspace = process.env.GITHUB_WORKSPACE;
  if (!workspace) {
    throw new Error("GITHUB_WORKSPACE is not set.");
  }

  const url = validateUrl(core.getInput("url", { required: true })).toString();
  const assetPath = core.getInput("image_path", { required: true });
  const readmePath = core.getInput("readme_path") || "README.md";
  const markerName = parseMarkerName(core.getInput("marker_name") || "screenshot");
  const shouldPush = parseBooleanInput("push", core.getInput("push") || "true");
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
  const commitMessage = core.getInput("commit_message") || "chore: update README screenshot";
  const gitUserName = core.getInput("git_user_name") || "github-actions[bot]";
  const gitUserEmail = core.getInput("git_user_email") || "41898282+github-actions[bot]@users.noreply.github.com";
  const targetBranchInput = core.getInput("target_branch").trim();
  const token = core.getInput("token") || undefined;

  validateAssetPathForFormat(assetPath, captureFormat);

  return {
    workspace,
    url,
    assetPath,
    assetAbsolutePath: resolveWorkspacePath(workspace, assetPath),
    readmePath,
    readmeAbsolutePath: resolveWorkspacePath(workspace, readmePath),
    markerName,
    shouldPush,
    captureFormat,
    viewportWidth,
    viewportHeight,
    waitUntil,
    navigationRetries,
    navigationRetryDelayMs,
    delayMs,
    gifDurationMs,
    browserPath: browserPathInput,
    commitMessage,
    gitUserName,
    gitUserEmail,
    targetBranch: targetBranchInput || undefined,
    token
  };
}
