import { mkdir } from "node:fs/promises";
import path from "node:path";

export type WaitUntil = "load" | "domcontentloaded" | "networkidle" | "commit";
export type CaptureFormat = "image" | "gif";

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

export async function ensureParentDirectory(filePath: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
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
