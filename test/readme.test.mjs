import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import {
  buildManagedPaths,
  parseBoolean,
  parseCaptureFormat,
  parseMarkerName,
  resolveWorkspacePath,
  retry,
  validateAssetPathForFormat
} from "../lib/lib.js";
import { commitAndPushIfNeeded } from "../lib/git.js";
import { buildReadmeImageBlock, replaceMarkedScreenshotBlock, updateReadme } from "../lib/readme.js";

const execFileAsync = promisify(execFile);

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

test("parseBoolean accepts supported values", () => {
  assert.equal(parseBoolean("commit_changes", "true"), true);
  assert.equal(parseBoolean("commit_changes", "FALSE"), false);
});

test("parseBoolean rejects unsupported values", () => {
  assert.throws(() => parseBoolean("commit_changes", "yes"), /commit_changes must be true or false/i);
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

test("buildManagedPaths preserves declared output ordering", () => {
  assert.deepEqual(buildManagedPaths("assets/screenshots/home.png", "README.md"), [
    "assets/screenshots/home.png",
    "README.md"
  ]);
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

test("commitAndPushIfNeeded returns false when managed files are unchanged", async () => {
  const repoDir = await mkdtemp(path.join(os.tmpdir(), "update-screenshots-action-git-noop-"));
  await initGitRepo(repoDir);

  await writeFile(path.join(repoDir, "README.md"), "# Example\n", "utf8");
  await writeFile(path.join(repoDir, "assets.png"), "image", "utf8");
  await git(repoDir, ["add", "--", "README.md", "assets.png"]);
  await git(repoDir, ["commit", "-m", "initial"]);

  const committed = await commitAndPushIfNeeded({
    workspace: repoDir,
    paths: ["assets.png", "README.md"],
    commitMessage: "docs: update screenshots",
    commitAuthorName: "github-actions[bot]",
    commitAuthorEmail: "41898282+github-actions[bot]@users.noreply.github.com"
  });

  assert.equal(committed, false);
});

test("commitAndPushIfNeeded commits and pushes managed files to the current branch", async () => {
  const remoteDir = await mkdtemp(path.join(os.tmpdir(), "update-screenshots-action-remote-"));
  await git(remoteDir, ["init", "--bare"]);

  const repoDir = await mkdtemp(path.join(os.tmpdir(), "update-screenshots-action-git-push-"));
  await initGitRepo(repoDir);
  await git(repoDir, ["remote", "add", "origin", remoteDir]);

  await writeFile(path.join(repoDir, "README.md"), "# Example\n", "utf8");
  await writeFile(path.join(repoDir, "assets.png"), "before", "utf8");
  await git(repoDir, ["add", "--", "README.md", "assets.png"]);
  await git(repoDir, ["commit", "-m", "initial"]);
  await git(repoDir, ["push", "-u", "origin", "main"]);

  await writeFile(path.join(repoDir, "README.md"), "# Example\n![Project screenshot](assets.png)\n", "utf8");
  await writeFile(path.join(repoDir, "assets.png"), "after", "utf8");
  await writeFile(path.join(repoDir, "IGNORED.txt"), "left unstaged", "utf8");

  const committed = await commitAndPushIfNeeded({
    workspace: repoDir,
    paths: ["assets.png", "README.md"],
    commitMessage: "docs: update screenshots",
    commitAuthorName: "github-actions[bot]",
    commitAuthorEmail: "41898282+github-actions[bot]@users.noreply.github.com"
  });

  assert.equal(committed, true);
  assert.match(await git(repoDir, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"]), /origin\/main/);
  assert.equal(await git(repoDir, ["show", "--format=%s", "--no-patch", "HEAD"]), "docs: update screenshots");
  assert.equal(await git(repoDir, ["status", "--short", "--", "IGNORED.txt"]), "?? IGNORED.txt");
  assert.equal(await git(repoDir, ["show", "origin/main:README.md"]), "# Example\n![Project screenshot](assets.png)");
});

test("commitAndPushIfNeeded fails on detached HEAD", async () => {
  const repoDir = await mkdtemp(path.join(os.tmpdir(), "update-screenshots-action-git-detached-"));
  await initGitRepo(repoDir);

  await writeFile(path.join(repoDir, "README.md"), "# Example\n", "utf8");
  await writeFile(path.join(repoDir, "assets.png"), "image", "utf8");
  await git(repoDir, ["add", "--", "README.md", "assets.png"]);
  await git(repoDir, ["commit", "-m", "initial"]);
  const initialSha = await git(repoDir, ["rev-parse", "HEAD"]);
  await git(repoDir, ["checkout", initialSha]);
  await writeFile(path.join(repoDir, "README.md"), "# Changed\n", "utf8");

  await assert.rejects(
    commitAndPushIfNeeded({
      workspace: repoDir,
      paths: ["assets.png", "README.md"],
      commitMessage: "docs: update screenshots",
      commitAuthorName: "github-actions[bot]",
      commitAuthorEmail: "41898282+github-actions[bot]@users.noreply.github.com"
    }),
    /Detached HEAD is not supported/i
  );
});

async function initGitRepo(repoDir) {
  await git(repoDir, ["init", "-b", "main"]);
  await git(repoDir, ["config", "user.name", "Test User"]);
  await git(repoDir, ["config", "user.email", "test@example.com"]);
}

async function git(cwd, args) {
  const { stdout } = await execFileAsync("git", args, { cwd });
  return stdout.trim();
}
