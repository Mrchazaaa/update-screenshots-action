import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type CommitPushOptions = {
  workspace: string;
  paths: string[];
  commitMessage: string;
  commitAuthorName: string;
  commitAuthorEmail: string;
};

export async function commitAndPushIfNeeded(options: CommitPushOptions): Promise<boolean> {
  await assertGitRepository(options.workspace);

  const branch = await getCurrentBranch(options.workspace);
  await git(options.workspace, ["add", "--", ...options.paths]);

  if (!(await hasStagedChanges(options.workspace, options.paths))) {
    return false;
  }

  const remote = await getPushRemote(options.workspace, branch);

  await git(options.workspace, [
    "-c",
    `user.name=${options.commitAuthorName}`,
    "-c",
    `user.email=${options.commitAuthorEmail}`,
    "commit",
    "-m",
    options.commitMessage
  ]);

  try {
    await git(options.workspace, ["push", remote, `HEAD:${branch}`]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to push commit to ${remote}/${branch}. ${message}`);
  }

  return true;
}

async function assertGitRepository(workspace: string): Promise<void> {
  try {
    await git(workspace, ["rev-parse", "--show-toplevel"]);
  } catch {
    throw new Error("commit_changes requires the workspace to be a git repository.");
  }
}

async function getCurrentBranch(workspace: string): Promise<string> {
  try {
    return await git(workspace, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
  } catch {
    throw new Error(
      "commit_changes requires a branch checkout. Detached HEAD is not supported; configure actions/checkout to check out a branch ref."
    );
  }
}

async function getPushRemote(workspace: string, branch: string): Promise<string> {
  try {
    return await git(workspace, ["config", "--get", `branch.${branch}.remote`]);
  } catch {
    try {
      await git(workspace, ["remote", "get-url", "origin"]);
      return "origin";
    } catch {
      throw new Error(
        `Could not determine a push remote for branch ${branch}. Ensure actions/checkout preserves credentials and configures a remote.`
      );
    }
  }
}

async function hasStagedChanges(workspace: string, paths: string[]): Promise<boolean> {
  try {
    await git(workspace, ["diff", "--cached", "--quiet", "--", ...paths]);
    return false;
  } catch (error) {
    if (error instanceof GitCommandError && error.exitCode === 1) {
      return true;
    }

    throw error;
  }
}

class GitCommandError extends Error {
  constructor(
    readonly args: string[],
    readonly exitCode: number,
    message: string
  ) {
    super(message);
    this.name = "GitCommandError";
  }
}

async function git(workspace: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", args, {
      cwd: workspace,
      env: process.env
    });
    return stdout.trim();
  } catch (error) {
    const exitCode =
      typeof error === "object" && error !== null && "code" in error && typeof error.code === "number" ? error.code : -1;
    const stderr =
      typeof error === "object" && error !== null && "stderr" in error && typeof error.stderr === "string"
        ? error.stderr.trim()
        : "";
    const stdout =
      typeof error === "object" && error !== null && "stdout" in error && typeof error.stdout === "string"
        ? error.stdout.trim()
        : "";

    const detail = stderr || stdout || "git command failed";
    throw new GitCommandError(args, exitCode, `git ${args.join(" ")} failed: ${detail}`);
  }
}
