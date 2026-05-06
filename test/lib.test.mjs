import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import {
  buildReadmeImageBlock,
  parseBooleanInput,
  parseCaptureFormat,
  parseMarkerName,
  retry,
  replaceMarkedScreenshotBlock,
  resolveWorkspacePath,
  updateReadme,
  validateAssetPathForFormat
} from "../lib/src/lib.js";

test("replaceMarkedScreenshotBlock rewrites only the marked block", () => {
  const current = [
    "# Example",
    "",
    "<!-- screenshot:start -->",
    "![Old](old.png)",
    "<!-- screenshot:end -->",
    "",
    "After"
  ].join("\n");

  const next = replaceMarkedScreenshotBlock(current, "assets/screenshots/home.png");

  assert.equal(
    next,
    [
      "# Example",
      "",
      buildReadmeImageBlock("assets/screenshots/home.png"),
      "",
      "After"
    ].join("\n")
  );
});

test("replaceMarkedScreenshotBlock rewrites only the selected named block", () => {
  const current = [
    "# Example",
    "",
    "<!-- hero:start -->",
    "![Old hero](hero-old.png)",
    "<!-- hero:end -->",
    "",
    "<!-- dashboard:start -->",
    "![Old dashboard](dashboard-old.png)",
    "<!-- dashboard:end -->"
  ].join("\n");

  const next = replaceMarkedScreenshotBlock(current, "assets/screenshots/dashboard.png", "dashboard");

  assert.equal(
    next,
    [
      "# Example",
      "",
      "<!-- hero:start -->",
      "![Old hero](hero-old.png)",
      "<!-- hero:end -->",
      "",
      buildReadmeImageBlock("assets/screenshots/dashboard.png", "dashboard")
    ].join("\n")
  );
});

test("replaceMarkedScreenshotBlock fails when markers are missing", () => {
  assert.throws(() => replaceMarkedScreenshotBlock("# Example", "shot.png"), /missing screenshot markers/i);
});

test("buildReadmeImageBlock preserves gif paths", () => {
  assert.equal(
    buildReadmeImageBlock("assets/screenshots/demo.gif"),
    ["<!-- screenshot:start -->", "![Project screenshot](assets/screenshots/demo.gif)", "<!-- screenshot:end -->"].join(
      "\n"
    )
  );
});

test("resolveWorkspacePath rejects absolute and escaping paths", () => {
  assert.throws(() => resolveWorkspacePath("/repo", "/tmp/out.png"), /repo-relative/);
  assert.throws(() => resolveWorkspacePath("/repo", "../out.png"), /within the repository workspace/);
});

test("parseCaptureFormat accepts supported values", () => {
  assert.equal(parseCaptureFormat("image"), "image");
  assert.equal(parseCaptureFormat("gif"), "gif");
});

test("parseCaptureFormat rejects unsupported values", () => {
  assert.throws(() => parseCaptureFormat("both"), /capture_format must be one of image, gif/i);
});

test("parseBooleanInput accepts supported values", () => {
  assert.equal(parseBooleanInput("push", "true"), true);
  assert.equal(parseBooleanInput("push", "false"), false);
});

test("parseBooleanInput rejects unsupported values", () => {
  assert.throws(() => parseBooleanInput("push", "yes"), /push must be true or false/i);
});

test("parseMarkerName accepts supported values", () => {
  assert.equal(parseMarkerName("screenshot"), "screenshot");
  assert.equal(parseMarkerName("hero_banner"), "hero_banner");
  assert.equal(parseMarkerName("dashboard-2"), "dashboard-2");
});

test("parseMarkerName rejects empty and unsupported values", () => {
  assert.throws(() => parseMarkerName(""), /marker_name must not be empty/i);
  assert.throws(() => parseMarkerName("hero banner"), /marker_name may only contain/i);
});

test("validateAssetPathForFormat enforces matching extensions", () => {
  assert.doesNotThrow(() => validateAssetPathForFormat("assets/screenshots/home.png", "image"));
  assert.doesNotThrow(() => validateAssetPathForFormat("assets/screenshots/home.gif", "gif"));
  assert.throws(
    () => validateAssetPathForFormat("assets/screenshots/home.gif", "image"),
    /capture_format image requires a \.png output path/i
  );
  assert.throws(
    () => validateAssetPathForFormat("assets/screenshots/home.png", "gif"),
    /capture_format gif requires a \.gif output path/i
  );
});

test("updateReadme reports false when content already matches", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "update-screenshots-action-"));
  const readmePath = path.join(tempDir, "README.md");
  const content = buildReadmeImageBlock("assets/screenshots/home.png");
  await writeFile(readmePath, content, "utf8");

  const changed = await updateReadme(readmePath, "assets/screenshots/home.png");
  const finalContent = await readFile(readmePath, "utf8");

  assert.equal(changed, false);
  assert.equal(finalContent, content);
});

test("updateReadme updates only the selected named block", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "update-screenshots-action-"));
  const readmePath = path.join(tempDir, "README.md");
  const content = [
    buildReadmeImageBlock("assets/screenshots/hero.png", "hero"),
    "",
    buildReadmeImageBlock("assets/screenshots/dashboard.png", "dashboard")
  ].join("\n");
  await writeFile(readmePath, content, "utf8");

  const changed = await updateReadme(readmePath, "assets/screenshots/dashboard-next.png", "dashboard");
  const finalContent = await readFile(readmePath, "utf8");

  assert.equal(changed, true);
  assert.equal(
    finalContent,
    [
      buildReadmeImageBlock("assets/screenshots/hero.png", "hero"),
      "",
      buildReadmeImageBlock("assets/screenshots/dashboard-next.png", "dashboard")
    ].join("\n")
  );
});

test("retry succeeds after transient failures", async () => {
  let attempts = 0;
  const retriedAttempts = [];

  const result = await retry(
    async () => {
      attempts += 1;
      if (attempts < 3) {
        throw new Error(`fail ${attempts}`);
      }

      return "ok";
    },
    {
      retries: 2,
      delayMs: 0,
      onRetry: (attemptNumber) => {
        retriedAttempts.push(attemptNumber);
      }
    }
  );

  assert.equal(result, "ok");
  assert.equal(attempts, 3);
  assert.deepEqual(retriedAttempts, [1, 2]);
});

test("retry rethrows after exhausting retries", async () => {
  await assert.rejects(
    retry(
      async () => {
        throw new Error("still failing");
      },
      {
        retries: 1,
        delayMs: 0
      }
    ),
    /still failing/
  );
});
