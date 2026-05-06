import * as core from "@actions/core";
import { chromium, type Page } from "playwright-core";
import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import path from "node:path";
import GIFEncoder from "gif-encoder-2";
import { PNG } from "pngjs";
import {
  ensureParentDirectory,
  parseCaptureFormat,
  findBrowserExecutable,
  parseInteger,
  parseMarkerName,
  parseWaitUntil,
  retry,
  resolveWorkspacePath,
  updateReadme,
  validateAssetPathForFormat,
  validateUrl
} from "./lib";

const execFileAsync = promisify(execFile);
const DEFAULT_GIF_FPS = 10;

async function run(): Promise<void> {
  try {
    const workspace = process.env.GITHUB_WORKSPACE;
    if (!workspace) {
      throw new Error("GITHUB_WORKSPACE is not set.");
    }

    const url = validateUrl(core.getInput("url", { required: true })).toString();
    const assetPath = core.getInput("image_path", { required: true });
    const readmePath = core.getInput("readme_path") || "README.md";
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
    const commitMessage = core.getInput("commit_message") || "chore: update README screenshot";
    const gitUserName = core.getInput("git_user_name") || "github-actions[bot]";
    const gitUserEmail =
      core.getInput("git_user_email") || "41898282+github-actions[bot]@users.noreply.github.com";
    const targetBranchInput = core.getInput("target_branch").trim();
    const targetBranch = targetBranchInput || undefined;
    const token = core.getInput("token") || undefined;

    validateAssetPathForFormat(assetPath, captureFormat);

    const assetAbsolutePath = resolveWorkspacePath(workspace, assetPath);
    const readmeAbsolutePath = resolveWorkspacePath(workspace, readmePath);
    const browserExecutable = await findBrowserExecutable(browserPathInput);

    await ensureParentDirectory(assetAbsolutePath);
    await captureAsset({
      browserExecutable,
      url,
      assetAbsolutePath,
      captureFormat,
      viewportWidth,
      viewportHeight,
      waitUntil,
      navigationRetries,
      navigationRetryDelayMs,
      delayMs,
      gifDurationMs
    });

    const readmeChanged = await updateReadme(readmeAbsolutePath, assetPath, markerName);
    const assetChanged = await hasTrackedChanges(workspace, [assetPath]);
    const changed = readmeChanged || assetChanged;

    core.setOutput("image_path", path.normalize(assetPath));

    if (!changed) {
      core.info("README and captured asset are already up to date.");
      core.setOutput("changed", "false");
      core.setOutput("commit_sha", "");
      return;
    }

    await configureGit(workspace, gitUserName, gitUserEmail);
    await stageFiles(workspace, [assetPath, readmePath]);

    const stagedDiff = await hasStagedChanges(workspace);
    if (!stagedDiff) {
      core.info("File rewrites produced no staged diff.");
      core.setOutput("changed", "false");
      core.setOutput("commit_sha", "");
      return;
    }

    const commitSha = await commitAndPush(workspace, commitMessage, token, targetBranch);
    core.setOutput("changed", "true");
    core.setOutput("commit_sha", commitSha);
  } catch (error) {
    core.setFailed(error instanceof Error ? error.message : String(error));
  }
}

type CaptureOptions = {
  browserExecutable: string;
  url: string;
  assetAbsolutePath: string;
  captureFormat: "image" | "gif";
  viewportWidth: number;
  viewportHeight: number;
  waitUntil: "load" | "domcontentloaded" | "networkidle" | "commit";
  navigationRetries: number;
  navigationRetryDelayMs: number;
  delayMs: number;
  gifDurationMs: number;
};

async function captureAsset(options: CaptureOptions): Promise<void> {
  const browser = await chromium.launch({
    executablePath: options.browserExecutable,
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"]
  });

  try {
    const page = await browser.newPage({
      viewport: {
        width: options.viewportWidth,
        height: options.viewportHeight
      }
    });

    await retry(
      async () => {
        await page.goto(options.url, { waitUntil: options.waitUntil });
      },
      {
        retries: options.navigationRetries,
        delayMs: options.navigationRetryDelayMs,
        onRetry: (attemptNumber, error) => {
          const message = error instanceof Error ? error.message : String(error);
          core.warning(
            `Navigation attempt ${attemptNumber} failed for ${options.url}: ${message}. Retrying in ${options.navigationRetryDelayMs}ms.`
          );
        }
      }
    );

    if (options.delayMs > 0) {
      await page.waitForTimeout(options.delayMs);
    }

    if (options.captureFormat === "gif") {
      await captureGif(page, options);
      return;
    }

    await page.screenshot({ path: options.assetAbsolutePath, type: "png", fullPage: false });
  } finally {
    await browser.close();
  }
}

async function captureGif(page: Page, options: CaptureOptions): Promise<void> {
  const frameDelayMs = Math.max(1000 / DEFAULT_GIF_FPS, 20);
  const frameCount = Math.max(1, Math.ceil(options.gifDurationMs / frameDelayMs));
  const encoder = new GIFEncoder(options.viewportWidth, options.viewportHeight, "neuquant", true, frameCount);

  encoder.start();
  encoder.setRepeat(0);
  encoder.setDelay(frameDelayMs);
  encoder.setQuality(10);

  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    const screenshotBuffer = (await page.screenshot({ type: "png", fullPage: false })) as Buffer;
    const png = PNG.sync.read(screenshotBuffer);
    encoder.addFrame(png.data);

    if (frameIndex < frameCount - 1) {
      await page.waitForTimeout(frameDelayMs);
    }
  }

  encoder.finish();
  await writeFile(options.assetAbsolutePath, encoder.out.getData());
}

async function configureGit(workspace: string, name: string, email: string): Promise<void> {
  await execGit(workspace, ["config", "user.name", name]);
  await execGit(workspace, ["config", "user.email", email]);
}

async function stageFiles(workspace: string, pathsToStage: string[]): Promise<void> {
  await execGit(workspace, ["add", "--", ...pathsToStage]);
}

async function hasTrackedChanges(workspace: string, pathsToCheck: string[]): Promise<boolean> {
  const { stdout } = await execGit(workspace, ["status", "--porcelain", "--", ...pathsToCheck]);
  return stdout.trim().length > 0;
}

async function hasStagedChanges(workspace: string): Promise<boolean> {
  try {
    await execGit(workspace, ["diff", "--cached", "--quiet"]);
    return false;
  } catch (error) {
    const exitCode = getExitCode(error);
    if (exitCode === 1) {
      return true;
    }

    throw error;
  }
}

async function commitAndPush(
  workspace: string,
  commitMessage: string,
  token?: string,
  targetBranch?: string
): Promise<string> {
  await execGit(workspace, ["commit", "-m", commitMessage]);

  const { stdout: shaStdout } = await execGit(workspace, ["rev-parse", "HEAD"]);
  const commitSha = shaStdout.trim();

  const branch = targetBranch || (await getBranchName(workspace));
  if (token) {
    await configureAuthenticatedRemote(workspace, token);
  }

  await execGit(workspace, ["push", "origin", `HEAD:${branch}`]);
  return commitSha;
}

async function getBranchName(workspace: string): Promise<string> {
  const { stdout } = await execGit(workspace, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const branch = stdout.trim();
  if (branch && branch !== "HEAD") {
    return branch;
  }

  const fallback = process.env.GITHUB_REF_NAME;
  if (fallback) {
    return fallback;
  }

  throw new Error("Could not determine the branch name for push.");
}

async function configureAuthenticatedRemote(workspace: string, token: string): Promise<void> {
  const { stdout } = await execGit(workspace, ["remote", "get-url", "origin"]);
  const remoteUrl = stdout.trim();
  if (!remoteUrl.startsWith("https://")) {
    return;
  }

  const authenticatedUrl = remoteUrl.replace("https://", `https://x-access-token:${token}@`);
  await execGit(workspace, ["remote", "set-url", "origin", authenticatedUrl]);
}

async function execGit(workspace: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync("git", args, {
    cwd: workspace,
    env: process.env
  });
}

function getExitCode(error: unknown): number | undefined {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "number") {
      return code;
    }
  }

  return undefined;
}

void run();
