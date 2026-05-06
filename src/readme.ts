import { readFile, writeFile } from "node:fs/promises";
import { toPosixPath } from "./lib";

const DEFAULT_MARKER_NAME = "screenshot";
const DEFAULT_ALT_TEXT = "Project screenshot";

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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildReadmeStartMarker(markerName: string): string {
  return `<!-- ${markerName}:start -->`;
}

function buildReadmeEndMarker(markerName: string): string {
  return `<!-- ${markerName}:end -->`;
}
