import * as core from "@actions/core";
import { captureAsset, findBrowserExecutable } from "./capture";
import { parseActionConfig } from "./config";
import { commitAndPush, configureGit, createGitClient, hasStagedChanges, hasTrackedChanges, stageFiles } from "./git";
import { ensureParentDirectory, toPosixPath } from "./lib";
import { updateReadme } from "./readme";

async function run(): Promise<void> {
  try {
    const config = parseActionConfig();
    const git = createGitClient(config.workspace);
    const browserExecutable = await findBrowserExecutable(config.browserPath);

    await ensureParentDirectory(config.assetAbsolutePath);
    await captureAsset({
      browserExecutable,
      url: config.url,
      assetAbsolutePath: config.assetAbsolutePath,
      captureFormat: config.captureFormat,
      viewportWidth: config.viewportWidth,
      viewportHeight: config.viewportHeight,
      waitUntil: config.waitUntil,
      navigationRetries: config.navigationRetries,
      navigationRetryDelayMs: config.navigationRetryDelayMs,
      delayMs: config.delayMs,
      gifDurationMs: config.gifDurationMs,
      onRetry: (attemptNumber, error) => {
        const message = error instanceof Error ? error.message : String(error);
        core.warning(
          `Navigation attempt ${attemptNumber} failed for ${config.url}: ${message}. Retrying in ${config.navigationRetryDelayMs}ms.`
        );
      }
    });

    const readmeChanged = await updateReadme(config.readmeAbsolutePath, config.assetPath, config.markerName);
    const assetChanged = await hasTrackedChanges(git, [config.assetPath]);
    const changed = readmeChanged || assetChanged;

    core.setOutput("image_path", toPosixPath(config.assetPath));

    if (!changed) {
      core.info("README and captured asset are already up to date.");
      core.setOutput("changed", "false");
      core.setOutput("commit_sha", "");
      return;
    }

    if (!config.shouldPush) {
      core.info("Files were updated without creating a commit because push is false.");
      core.setOutput("changed", "true");
      core.setOutput("commit_sha", "");
      return;
    }

    await configureGit(git, config.gitUserName, config.gitUserEmail);
    await stageFiles(git, [config.assetPath, config.readmePath]);

    const stagedDiff = await hasStagedChanges(git);
    if (!stagedDiff) {
      core.info("File rewrites produced no staged diff.");
      core.setOutput("changed", "false");
      core.setOutput("commit_sha", "");
      return;
    }

    const commitSha = await commitAndPush(git, {
      commitMessage: config.commitMessage,
      token: config.token,
      targetBranch: config.targetBranch,
      fallbackBranch: process.env.GITHUB_REF_NAME
    });
    core.setOutput("changed", "true");
    core.setOutput("commit_sha", commitSha);
  } catch (error) {
    core.setFailed(error instanceof Error ? error.message : String(error));
  }
}

void run();
