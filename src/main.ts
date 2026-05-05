import * as core from "@actions/core";
import { chromium } from "playwright-core";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import {
  ensureParentDirectory,
  findBrowserExecutable,
  parseInteger,
  parseWaitUntil,
  resolveWorkspacePath,
  updateReadme,
  validateUrl
} from "./lib";

const execFileAsync = promisify(execFile);

async function run(): Promise<void> {
  try {
    const workspace = process.env.GITHUB_WORKSPACE;
    if (!workspace) {
      throw new Error("GITHUB_WORKSPACE is not set.");
    }

    const url = validateUrl(core.getInput("url", { required: true })).toString();
    const imagePath = core.getInput("image_path", { required: true });
    const readmePath = core.getInput("readme_path") || "README.md";
    const viewportWidth = parseInteger("viewport_width", core.getInput("viewport_width") || "1440");
    const viewportHeight = parseInteger("viewport_height", core.getInput("viewport_height") || "900");
    const waitUntil = parseWaitUntil(core.getInput("wait_until") || "networkidle");
    const delayMs = parseInteger("delay_ms", core.getInput("delay_ms") || "0");
    const browserPathInput = core.getInput("browser_path") || undefined;
    const commitMessage = core.getInput("commit_message") || "chore: update README screenshot";
    const gitUserName = core.getInput("git_user_name") || "github-actions[bot]";
    const gitUserEmail =
      core.getInput("git_user_email") || "41898282+github-actions[bot]@users.noreply.github.com";
    const token = core.getInput("token") || undefined;

    const imageAbsolutePath = resolveWorkspacePath(workspace, imagePath);
    const readmeAbsolutePath = resolveWorkspacePath(workspace, readmePath);
    const browserExecutable = await findBrowserExecutable(browserPathInput);

    await ensureParentDirectory(imageAbsolutePath);
    await captureScreenshot({
      browserExecutable,
      url,
      imageAbsolutePath,
      viewportWidth,
      viewportHeight,
      waitUntil,
      delayMs
    });

    const readmeChanged = await updateReadme(readmeAbsolutePath, imagePath);
    const screenshotChanged = await hasTrackedChanges(workspace, [imagePath]);
    const changed = readmeChanged || screenshotChanged;

    core.setOutput("image_path", path.normalize(imagePath));

    if (!changed) {
      core.info("README and screenshot are already up to date.");
      core.setOutput("changed", "false");
      core.setOutput("commit_sha", "");
      return;
    }

    await configureGit(workspace, gitUserName, gitUserEmail);
    await stageFiles(workspace, [imagePath, readmePath]);

    const stagedDiff = await hasStagedChanges(workspace);
    if (!stagedDiff) {
      core.info("File rewrites produced no staged diff.");
      core.setOutput("changed", "false");
      core.setOutput("commit_sha", "");
      return;
    }

    const commitSha = await commitAndPush(workspace, commitMessage, token);
    core.setOutput("changed", "true");
    core.setOutput("commit_sha", commitSha);
  } catch (error) {
    core.setFailed(error instanceof Error ? error.message : String(error));
  }
}

type CaptureOptions = {
  browserExecutable: string;
  url: string;
  imageAbsolutePath: string;
  viewportWidth: number;
  viewportHeight: number;
  waitUntil: "load" | "domcontentloaded" | "networkidle" | "commit";
  delayMs: number;
};

async function captureScreenshot(options: CaptureOptions): Promise<void> {
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

    await page.goto(options.url, { waitUntil: options.waitUntil });
    if (options.delayMs > 0) {
      await page.waitForTimeout(options.delayMs);
    }

    await page.screenshot({
      path: options.imageAbsolutePath,
      type: "png",
      fullPage: false
    });
  } finally {
    await browser.close();
  }
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

async function commitAndPush(workspace: string, commitMessage: string, token?: string): Promise<string> {
  await execGit(workspace, ["commit", "-m", commitMessage]);

  const { stdout: shaStdout } = await execGit(workspace, ["rev-parse", "HEAD"]);
  const commitSha = shaStdout.trim();

  const branch = await getBranchName(workspace);
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
