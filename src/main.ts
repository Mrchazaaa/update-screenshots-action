import * as core from "@actions/core";
import { captureAsset, findBrowserExecutable } from "./capture";
import { parseActionConfig } from "./config";
import { commitAndPushIfNeeded } from "./git";
import { ensureParentDirectory, toPosixPath } from "./lib";
import { updateReadme } from "./readme";

async function run(): Promise<void> {
  try {
    const config = parseActionConfig();
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
    core.setOutput("image_path", toPosixPath(config.assetPath));
    core.info(`Captured ${config.captureFormat} asset at ${toPosixPath(config.assetPath)}.`);
    if (readmeChanged) {
      core.info(`Updated README marker ${config.markerName} in ${toPosixPath(config.readmePath)}.`);
    } else {
      core.info(`README marker ${config.markerName} in ${toPosixPath(config.readmePath)} was already up to date.`);
    }

    let committed = false;
    if (config.commitChanges) {
      committed = await commitAndPushIfNeeded({
        workspace: config.workspace,
        paths: config.managedPaths,
        commitMessage: config.commitMessage,
        commitAuthorName: config.commitAuthorName,
        commitAuthorEmail: config.commitAuthorEmail
      });

      if (committed) {
        core.info("Committed and pushed updated screenshot artifacts.");
      } else {
        core.info("No managed file changes were staged, so commit and push were skipped.");
      }
    }

    core.setOutput("committed", committed ? "true" : "false");
  } catch (error) {
    core.setFailed(error instanceof Error ? error.message : String(error));
  }
}

void run();
