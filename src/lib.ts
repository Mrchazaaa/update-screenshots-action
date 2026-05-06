import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { constants } from "node:fs";

const DEFAULT_MARKER_NAME = "screenshot";

const DEFAULT_ALT_TEXT = "Project screenshot";

export type WaitUntil = "load" | "domcontentloaded" | "networkidle" | "commit";
export type CaptureFormat = "image" | "gif";

export type ActionOptions = {
  workspace: string;
  url: string;
  imagePath: string;
  readmePath: string;
  viewportWidth: number;
  viewportHeight: number;
  waitUntil: WaitUntil;
  navigationRetries: number;
  navigationRetryDelayMs: number;
  delayMs: number;
  browserPath?: string;
  commitMessage: string;
  gitUserName: string;
  gitUserEmail: string;
  token?: string;
};

export type RetryOptions = {
  retries: number;
  delayMs: number;
  onRetry?: (attemptNumber: number, error: unknown) => void;
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

export function parseCaptureFormat(value: string): CaptureFormat {
  if (value === "image" || value === "gif") {
    return value;
  }

  throw new Error(`capture_format must be one of image, gif. Received: ${value}`);
}

export function parseBooleanInput(name: string, value: string): boolean {
  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  throw new Error(`${name} must be true or false. Received: ${value}`);
}

export function parseMarkerName(value: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error("marker_name must not be empty.");
  }

  if (!/^[A-Za-z0-9_-]+$/.test(normalized)) {
    throw new Error(`marker_name may only contain letters, numbers, underscores, and hyphens. Received: ${value}`);
  }

  return normalized;
}

export function validateAssetPathForFormat(assetPath: string, captureFormat: CaptureFormat): void {
  const expectedExtension = captureFormat === "image" ? ".png" : ".gif";
  const actualExtension = path.extname(assetPath).toLowerCase();

  if (actualExtension !== expectedExtension) {
    throw new Error(`capture_format ${captureFormat} requires a ${expectedExtension} output path. Received: ${assetPath}`);
  }
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

export function buildReadmeImageBlock(imagePath: string, markerName = DEFAULT_MARKER_NAME): string {
  const posixPath = toPosixPath(imagePath);
  return `${buildReadmeStartMarker(markerName)}\n![${DEFAULT_ALT_TEXT}](${posixPath})\n${buildReadmeEndMarker(markerName)}`;
}

export function replaceMarkedScreenshotBlock(readme: string, imagePath: string, markerName = DEFAULT_MARKER_NAME): string {
  const startMarker = buildReadmeStartMarker(markerName);
  const endMarker = buildReadmeEndMarker(markerName);
  const blockPattern = new RegExp(
    `${escapeRegExp(startMarker)}[\\s\\S]*?${escapeRegExp(endMarker)}`,
    "m"
  );

  if (!blockPattern.test(readme)) {
    throw new Error(`README is missing screenshot markers. Expected ${startMarker} and ${endMarker}.`);
  }

  return readme.replace(blockPattern, buildReadmeImageBlock(imagePath, markerName));
}

export async function updateReadme(readmeAbsolutePath: string, imagePath: string, markerName = DEFAULT_MARKER_NAME): Promise<boolean> {
  const current = await readFile(readmeAbsolutePath, "utf8");
  const next = replaceMarkedScreenshotBlock(current, imagePath, markerName);
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

export async function sleep(delayMs: number): Promise<void> {
  if (delayMs <= 0) {
    return;
  }

  await new Promise((resolve) => setTimeout(resolve, delayMs));
}

export async function retry<T>(operation: () => Promise<T>, options: RetryOptions): Promise<T> {
  let attemptNumber = 0;

  while (true) {
    attemptNumber += 1;

    try {
      return await operation();
    } catch (error) {
      if (attemptNumber > options.retries) {
        throw error;
      }

      options.onRetry?.(attemptNumber, error);
      await sleep(options.delayMs);
    }
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildReadmeStartMarker(markerName: string): string {
  return `<!-- ${markerName}:start -->`;
}

function buildReadmeEndMarker(markerName: string): string {
  return `<!-- ${markerName}:end -->`;
}
