import test from "node:test";
import assert from "node:assert/strict";
import { commitAndPush, getCurrentBranchName } from "../lib/git.js";

function createMockGit(sequence) {
  const calls = [];
  let currentBranch = "main";

  return {
    calls,
    client: {
      async exec(args) {
        calls.push(args);
        if (args[0] === "rev-parse" && args[1] === "--abbrev-ref" && args[2] === "HEAD") {
          return { stdout: `${currentBranch}\n`, stderr: "" };
        }

        if (args[0] === "checkout" && args[1] === "-B") {
          currentBranch = args[2];
        } else if (args[0] === "checkout" && args[1]) {
          currentBranch = args[1];
        }

        const key = args.join(" ");
        if (!(key in sequence)) {
          throw new Error(`Unexpected git command: ${key}`);
        }

        const response = sequence[key];
        if (response instanceof Error) {
          throw response;
        }

        return response;
      }
    }
  };
}

function gitError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

test("getCurrentBranchName returns undefined for detached HEAD", async () => {
  const git = createMockGit({
    "rev-parse --abbrev-ref HEAD": { stdout: "HEAD\n", stderr: "" }
  });

  git.client.exec = async (args) => {
    git.calls.push(args);
    return { stdout: "HEAD\n", stderr: "" };
  };

  const branch = await getCurrentBranchName(git.client);
  assert.equal(branch, undefined);
});

test("commitAndPush rebases and pushes current branch", async () => {
  const git = createMockGit({
    "commit -m chore: update": { stdout: "", stderr: "" },
    "rev-parse HEAD": { stdout: "abc123\n", stderr: "" },
    "ls-remote --exit-code --heads origin main": { stdout: "ref\n", stderr: "" },
    "fetch origin main": { stdout: "", stderr: "" },
    "rebase FETCH_HEAD": { stdout: "", stderr: "" },
    "push origin HEAD:main": { stdout: "", stderr: "" }
  });

  const commitSha = await commitAndPush(git.client, {
    commitMessage: "chore: update"
  });

  assert.equal(commitSha, "abc123");
  assert.deepEqual(git.calls, [
    ["commit", "-m", "chore: update"],
    ["rev-parse", "HEAD"],
    ["rev-parse", "--abbrev-ref", "HEAD"],
    ["ls-remote", "--exit-code", "--heads", "origin", "main"],
    ["fetch", "origin", "main"],
    ["rebase", "FETCH_HEAD"],
    ["push", "origin", "HEAD:main"]
  ]);
});

test("commitAndPush publishes to a dedicated target branch without rebasing the current branch", async () => {
  const git = createMockGit({
    "commit -m chore: update": { stdout: "", stderr: "" },
    "rev-parse HEAD": { stdout: "abc123\n", stderr: "" },
    "ls-remote --exit-code --heads origin automation": { stdout: "ref\n", stderr: "" },
    "fetch origin automation": { stdout: "", stderr: "" },
    "checkout -B update-screenshots-action/12345 FETCH_HEAD": { stdout: "", stderr: "" },
    "cherry-pick --strategy-option theirs abc123": { stdout: "", stderr: "" },
    "push origin HEAD:refs/heads/automation": { stdout: "", stderr: "" },
    "checkout main": { stdout: "", stderr: "" },
    "branch -D update-screenshots-action/12345": { stdout: "", stderr: "" }
  });

  const originalNow = Date.now;
  Date.now = () => 12345;

  try {
    const commitSha = await commitAndPush(git.client, {
      commitMessage: "chore: update",
      targetBranch: "automation"
    });

    assert.equal(commitSha, "abc123");
  } finally {
    Date.now = originalNow;
  }

  assert.deepEqual(git.calls, [
    ["commit", "-m", "chore: update"],
    ["rev-parse", "HEAD"],
    ["rev-parse", "--abbrev-ref", "HEAD"],
    ["ls-remote", "--exit-code", "--heads", "origin", "automation"],
    ["rev-parse", "--abbrev-ref", "HEAD"],
    ["fetch", "origin", "automation"],
    ["checkout", "-B", "update-screenshots-action/12345", "FETCH_HEAD"],
    ["cherry-pick", "--strategy-option", "theirs", "abc123"],
    ["push", "origin", "HEAD:refs/heads/automation"],
    ["rev-parse", "--abbrev-ref", "HEAD"],
    ["checkout", "main"],
    ["branch", "-D", "update-screenshots-action/12345"]
  ]);
});

test("commitAndPush pushes directly when the target branch does not yet exist", async () => {
  const git = createMockGit({
    "commit -m chore: update": { stdout: "", stderr: "" },
    "rev-parse HEAD": { stdout: "abc123\n", stderr: "" },
    "ls-remote --exit-code --heads origin automation": gitError(2, "missing"),
    "push origin abc123:refs/heads/automation": { stdout: "", stderr: "" }
  });

  const commitSha = await commitAndPush(git.client, {
    commitMessage: "chore: update",
    targetBranch: "automation"
  });

  assert.equal(commitSha, "abc123");
  assert.deepEqual(git.calls, [
    ["commit", "-m", "chore: update"],
    ["rev-parse", "HEAD"],
    ["rev-parse", "--abbrev-ref", "HEAD"],
    ["ls-remote", "--exit-code", "--heads", "origin", "automation"],
    ["push", "origin", "abc123:refs/heads/automation"]
  ]);
});
