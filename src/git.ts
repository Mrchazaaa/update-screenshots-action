import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type GitResult = {
  stdout: string;
  stderr: string;
};

export type GitClient = {
  exec(args: string[]): Promise<GitResult>;
};

export function createGitClient(workspace: string): GitClient {
  return {
    exec(args: string[]) {
      return execFileAsync("git", args, {
        cwd: workspace,
        env: process.env
      });
    }
  };
}

export async function configureGit(client: GitClient, name: string, email: string): Promise<void> {
  await client.exec(["config", "user.name", name]);
  await client.exec(["config", "user.email", email]);
}

export async function stageFiles(client: GitClient, pathsToStage: string[]): Promise<void> {
  await client.exec(["add", "--", ...pathsToStage]);
}

export async function hasTrackedChanges(client: GitClient, pathsToCheck: string[]): Promise<boolean> {
  const { stdout } = await client.exec(["status", "--porcelain", "--", ...pathsToCheck]);
  return stdout.trim().length > 0;
}

export async function hasStagedChanges(client: GitClient): Promise<boolean> {
  try {
    await client.exec(["diff", "--cached", "--quiet"]);
    return false;
  } catch (error) {
    const exitCode = getExitCode(error);
    if (exitCode === 1) {
      return true;
    }

    throw error;
  }
}

export type CommitAndPushOptions = {
  commitMessage: string;
  token?: string;
  targetBranch?: string;
  fallbackBranch?: string;
};

export async function commitAndPush(client: GitClient, options: CommitAndPushOptions): Promise<string> {
  await client.exec(["commit", "-m", options.commitMessage]);

  const { stdout: shaStdout } = await client.exec(["rev-parse", "HEAD"]);
  const commitSha = shaStdout.trim();
  const currentBranch = await getCurrentBranchName(client);
  const branch = options.targetBranch || currentBranch || options.fallbackBranch;

  if (!branch) {
    throw new Error("Could not determine the branch name for push.");
  }

  await withAuthenticatedRemote(client, options.token, async () => {
    if (options.targetBranch && currentBranch !== options.targetBranch) {
      await publishToTargetBranch(client, commitSha, options.targetBranch);
      return;
    }

    await rebaseOntoRemoteBranch(client, branch);
    await client.exec(["push", "origin", `HEAD:${branch}`]);
  });

  return commitSha;
}

export async function getCurrentBranchName(client: GitClient): Promise<string | undefined> {
  const { stdout } = await client.exec(["rev-parse", "--abbrev-ref", "HEAD"]);
  const branch = stdout.trim();
  if (branch && branch !== "HEAD") {
    return branch;
  }

  return undefined;
}

async function publishToTargetBranch(client: GitClient, commitSha: string, targetBranch: string): Promise<void> {
  const remoteBranchExists = await hasRemoteBranch(client, targetBranch);
  if (!remoteBranchExists) {
    await client.exec(["push", "origin", `${commitSha}:refs/heads/${targetBranch}`]);
    return;
  }

  const restoreRef = await getRestoreRef(client);
  const tempBranch = `update-screenshots-action/${Date.now()}`;

  await client.exec(["fetch", "origin", targetBranch]);

  try {
    await client.exec(["checkout", "-B", tempBranch, "FETCH_HEAD"]);
    await client.exec(["cherry-pick", "--strategy-option", "theirs", commitSha]);
    await client.exec(["push", "origin", `HEAD:refs/heads/${targetBranch}`]);
  } catch (error) {
    await abortCherryPickIfNeeded(client);
    throw new Error(
      `Could not publish the generated commit onto origin/${targetBranch}. Resolve the branch conflict and rerun the workflow.`
    );
  } finally {
    await restoreCheckout(client, restoreRef);
    await deleteBranchIfPresent(client, tempBranch);
  }
}

async function withAuthenticatedRemote<T>(client: GitClient, token: string | undefined, operation: () => Promise<T>): Promise<T> {
  if (!token) {
    return operation();
  }

  const { stdout } = await client.exec(["remote", "get-url", "origin"]);
  const remoteUrl = stdout.trim();
  if (!remoteUrl.startsWith("https://")) {
    return operation();
  }

  const authenticatedUrl = remoteUrl.replace("https://", `https://x-access-token:${token}@`);
  await client.exec(["remote", "set-url", "origin", authenticatedUrl]);

  try {
    return await operation();
  } finally {
    await client.exec(["remote", "set-url", "origin", remoteUrl]);
  }
}

async function rebaseOntoRemoteBranch(client: GitClient, branch: string): Promise<void> {
  const remoteBranchExists = await hasRemoteBranch(client, branch);
  if (!remoteBranchExists) {
    return;
  }

  await client.exec(["fetch", "origin", branch]);

  try {
    await client.exec(["rebase", "FETCH_HEAD"]);
  } catch (error) {
    await abortRebaseIfNeeded(client);
    throw new Error(`Could not rebase the generated commit onto origin/${branch}. Resolve the branch conflict and rerun the workflow.`);
  }
}

async function hasRemoteBranch(client: GitClient, branch: string): Promise<boolean> {
  try {
    await client.exec(["ls-remote", "--exit-code", "--heads", "origin", branch]);
    return true;
  } catch (error) {
    const exitCode = getExitCode(error);
    if (exitCode === 2) {
      return false;
    }

    throw error;
  }
}

async function abortRebaseIfNeeded(client: GitClient): Promise<void> {
  try {
    await client.exec(["rebase", "--abort"]);
  } catch (error) {
    const exitCode = getExitCode(error);
    if (exitCode === 128) {
      return;
    }

    throw error;
  }
}

async function abortCherryPickIfNeeded(client: GitClient): Promise<void> {
  try {
    await client.exec(["cherry-pick", "--abort"]);
  } catch (error) {
    const exitCode = getExitCode(error);
    if (exitCode === 128) {
      return;
    }

    throw error;
  }
}

async function getRestoreRef(client: GitClient): Promise<string> {
  const branch = await getCurrentBranchName(client);
  if (branch) {
    return branch;
  }

  const { stdout } = await client.exec(["rev-parse", "HEAD"]);
  return stdout.trim();
}

async function restoreCheckout(client: GitClient, restoreRef: string): Promise<void> {
  const currentBranch = await getCurrentBranchName(client);
  if (currentBranch === restoreRef) {
    return;
  }

  await client.exec(["checkout", restoreRef]);
}

async function deleteBranchIfPresent(client: GitClient, branch: string): Promise<void> {
  try {
    await client.exec(["branch", "-D", branch]);
  } catch (error) {
    const exitCode = getExitCode(error);
    if (exitCode === 1 || exitCode === 128) {
      return;
    }

    throw error;
  }
}

function getExitCode(error: unknown): number | undefined {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "number") {
      return code;
    }
  }

  return undefined;
}
