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

    await ensureParentDirectory(config.captureAbsolutePath);
    await captureAsset({
      browserExecutable,
      url: config.url,
      assetAbsolutePath: config.captureAbsolutePath,
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

    const readmeChanged = await updateReadme(config.markdownAbsolutePath, config.capturePath, config.markerName);
    core.setOutput("capture_path", toPosixPath(config.capturePath));
    core.info(`Captured ${config.captureFormat} asset at ${toPosixPath(config.capturePath)}.`);
    if (readmeChanged) {
      core.info(`Updated Markdown marker ${config.markerName} in ${toPosixPath(config.markdownPath)}.`);
    } else {
      core.info(`Markdown marker ${config.markerName} in ${toPosixPath(config.markdownPath)} was already up to date.`);
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
