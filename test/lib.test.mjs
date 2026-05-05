import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import {
  buildReadmeImageBlock,
  replaceMarkedScreenshotBlock,
  resolveWorkspacePath,
  updateReadme
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

test("replaceMarkedScreenshotBlock fails when markers are missing", () => {
  assert.throws(() => replaceMarkedScreenshotBlock("# Example", "shot.png"), /missing screenshot markers/i);
});

test("resolveWorkspacePath rejects absolute and escaping paths", () => {
  assert.throws(() => resolveWorkspacePath("/repo", "/tmp/out.png"), /repo-relative/);
  assert.throws(() => resolveWorkspacePath("/repo", "../out.png"), /within the repository workspace/);
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
