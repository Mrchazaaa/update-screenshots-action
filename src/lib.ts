import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { constants } from "node:fs";

const README_START_MARKER = "<!-- screenshot:start -->";
const README_END_MARKER = "<!-- screenshot:end -->";

const DEFAULT_ALT_TEXT = "Project screenshot";

export type WaitUntil = "load" | "domcontentloaded" | "networkidle" | "commit";

export type ActionOptions = {
  workspace: string;
  url: string;
  imagePath: string;
  readmePath: string;
  viewportWidth: number;
  viewportHeight: number;
  waitUntil: WaitUntil;
  delayMs: number;
  browserPath?: string;
  commitMessage: string;
  gitUserName: string;
  gitUserEmail: string;
  token?: string;
};

export function validateUrl(input: string): URL {
  try {
    return new URL(input);
  } catch {
    throw new Error(`Invalid URL: ${input}`);
  }
}

export function parseInteger(name: string, value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative integer. Received: ${value}`);
  }

  return parsed;
}

export function parseWaitUntil(value: string): WaitUntil {
  if (value === "load" || value === "domcontentloaded" || value === "networkidle" || value === "commit") {
    return value;
  }

  throw new Error(`wait_until must be one of load, domcontentloaded, networkidle, commit. Received: ${value}`);
}

export function resolveWorkspacePath(workspace: string, repoRelativePath: string): string {
  if (!repoRelativePath.trim()) {
    throw new Error("Path inputs must not be empty.");
  }

  if (path.isAbsolute(repoRelativePath)) {
    throw new Error(`Path must be repo-relative, not absolute: ${repoRelativePath}`);
  }

  const normalized = path.normalize(repoRelativePath);
  if (normalized === ".." || normalized.startsWith(`..${path.sep}`)) {
    throw new Error(`Path must stay within the repository workspace: ${repoRelativePath}`);
  }

  return path.resolve(workspace, normalized);
}

export function toPosixPath(value: string): string {
  return value.split(path.sep).join("/");
}

export function buildReadmeImageBlock(imagePath: string): string {
  const posixPath = toPosixPath(imagePath);
  return `${README_START_MARKER}\n![${DEFAULT_ALT_TEXT}](${posixPath})\n${README_END_MARKER}`;
}

export function replaceMarkedScreenshotBlock(readme: string, imagePath: string): string {
  const blockPattern = new RegExp(
    `${escapeRegExp(README_START_MARKER)}[\\s\\S]*?${escapeRegExp(README_END_MARKER)}`,
    "m"
  );

  if (!blockPattern.test(readme)) {
    throw new Error(
      `README is missing screenshot markers. Expected ${README_START_MARKER} and ${README_END_MARKER}.`
    );
  }

  return readme.replace(blockPattern, buildReadmeImageBlock(imagePath));
}

export async function updateReadme(readmeAbsolutePath: string, imagePath: string): Promise<boolean> {
  const current = await readFile(readmeAbsolutePath, "utf8");
  const next = replaceMarkedScreenshotBlock(current, imagePath);
  if (current === next) {
    return false;
  }

  await writeFile(readmeAbsolutePath, next, "utf8");
  return true;
}

export async function ensureParentDirectory(filePath: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
}

export async function findBrowserExecutable(explicitPath?: string): Promise<string> {
  const candidates = explicitPath
    ? [explicitPath]
    : [
        process.env.CHROME_BIN,
        "/usr/bin/google-chrome",
        "/usr/bin/google-chrome-stable",
        "/usr/bin/chromium-browser",
        "/usr/bin/chromium"
      ];

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }

    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      continue;
    }
  }

  throw new Error(
    "Could not find a Chrome or Chromium executable. Set the browser_path input if your runner uses a custom location."
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
