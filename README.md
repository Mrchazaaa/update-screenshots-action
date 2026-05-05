# update-screenshots-action

A publishable GitHub Action that captures a screenshot of a site, writes it to a repo-relative path, updates a marked block in the root `README.md`, then commits and pushes the change.

## What It Does

- Opens a caller-provided URL in Chromium via `playwright-core`
- Captures a PNG screenshot using a fixed viewport
- Rewrites a marked block in the target README to point at the screenshot path
- Commits and pushes the changed README and image back to the current branch

## Required README Markers

The target README must contain this exact marker pair:

```md
<!-- screenshot:start -->
![Project screenshot](assets/screenshots/home.png)
<!-- screenshot:end -->
```

Everything between those markers is replaced with a single Markdown image reference that points at the action's `image_path` input.

## Usage

```yaml
name: Update screenshot

on:
  workflow_dispatch:
  schedule:
    - cron: "0 9 * * *"

permissions:
  contents: write

jobs:
  update-screenshot:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: Mrchazaaa/update-screenshots-action@v1
        with:
          url: https://example.com
          image_path: assets/screenshots/home.png
```

## Inputs

| Input | Required | Default | Description |
| --- | --- | --- | --- |
| `url` | Yes |  | URL to open and capture |
| `image_path` | Yes |  | Repo-relative screenshot output path |
| `readme_path` | No | `README.md` | Repo-relative README path |
| `viewport_width` | No | `1440` | Browser viewport width |
| `viewport_height` | No | `900` | Browser viewport height |
| `wait_until` | No | `networkidle` | Playwright navigation wait mode |
| `delay_ms` | No | `0` | Extra wait after navigation |
| `browser_path` | No |  | Explicit browser executable path |
| `commit_message` | No | `chore: update README screenshot` | Commit message |
| `git_user_name` | No | `github-actions[bot]` | Git author name |
| `git_user_email` | No | `41898282+github-actions[bot]@users.noreply.github.com` | Git author email |
| `token` | No | `${{ github.token }}` | Token used for push authentication |

## Outputs

| Output | Description |
| --- | --- |
| `changed` | `true` if a commit was created |
| `commit_sha` | Commit SHA when changes were pushed |
| `image_path` | The repo-relative screenshot path that was written |

## Notes

- The action fails if the README markers are missing.
- By default it looks for Chrome or Chromium in common GitHub-hosted runner locations.
- The caller workflow must grant `contents: write`.

## Development

```bash
npm install
npm test
npm run build
```
