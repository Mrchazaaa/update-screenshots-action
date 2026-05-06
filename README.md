# update-screenshots-action

A publishable GitHub Action that captures a site as either a static PNG or an animated GIF, writes it to a repo-relative path, updates a marked block in the root `README.md`, then commits and pushes the change.

## What It Does

- Opens a caller-provided URL in Chromium via `playwright-core`
- Captures either a PNG screenshot or an animated GIF using a fixed viewport
- Rewrites a marked block in the target README to point at the captured asset path
- Commits and pushes the changed README and asset back to the current branch

If you trigger the workflow from `push` events on `main`, set `target_branch` to a dedicated automation branch so screenshot commits do not keep advancing `main`.

## Required README Markers

The target README must contain this exact marker pair:

```md
<!-- screenshot:start -->
![Project screenshot](assets/screenshots/home.png)
<!-- screenshot:end -->
```

Everything between those markers is replaced with a single Markdown image reference that points at the action's `image_path` input.

To update multiple screenshots in the same Markdown file, run the action multiple times with different `marker_name` values and matching marker pairs such as `<!-- hero:start --> ... <!-- hero:end -->` and `<!-- dashboard:start --> ... <!-- dashboard:end -->`. For that workflow shape, set `push: false` on each invocation and do one final git commit/push step at the end.

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
          marker_name: screenshot
          push: true
          capture_format: image
          navigation_retries: 5
          navigation_retry_delay_ms: 1000
          target_branch: automation/update-screenshot
```

GIF capture example:

```yaml
- uses: Mrchazaaa/update-screenshots-action@v1
  with:
    url: https://example.com
    image_path: assets/screenshots/home.gif
    capture_format: gif
    gif_duration_ms: 3000
```

Multiple markers in one file:

```yaml
- uses: Mrchazaaa/update-screenshots-action@v1
  with:
    url: https://example.com/hero
    image_path: assets/screenshots/hero.png
    marker_name: hero
    push: false

- uses: Mrchazaaa/update-screenshots-action@v1
  with:
    url: https://example.com/dashboard
    image_path: assets/screenshots/dashboard.png
    marker_name: dashboard
    push: false

- name: Commit screenshot updates
  run: |
    git config user.name github-actions[bot]
    git config user.email 41898282+github-actions[bot]@users.noreply.github.com
    git add README.md assets/screenshots/hero.png assets/screenshots/dashboard.png
    git commit -m "chore: update screenshots"
    git push
```

## Inputs

| Input | Required | Default | Description |
| --- | --- | --- | --- |
| `url` | Yes |  | URL to open and capture |
| `image_path` | Yes |  | Repo-relative output path for the captured asset |
| `marker_name` | No | `screenshot` | Marker name used to choose which `<!-- name:start -->` / `<!-- name:end -->` block to rewrite |
| `push` | No | `true` | Create and push a commit when `true`; only update files in the workspace when `false` |
| `capture_format` | No | `image` | Capture `image` for PNG output or `gif` for animated GIF output |
| `readme_path` | No | `README.md` | Repo-relative README path |
| `viewport_width` | No | `1440` | Browser viewport width |
| `viewport_height` | No | `900` | Browser viewport height |
| `wait_until` | No | `networkidle` | Playwright navigation wait mode |
| `navigation_retries` | No | `0` | Number of times to retry navigation after the first failure |
| `navigation_retry_delay_ms` | No | `1000` | Delay between navigation retry attempts |
| `delay_ms` | No | `0` | Extra wait after navigation |
| `gif_duration_ms` | No | `1000` | GIF capture duration in milliseconds when `capture_format` is `gif` |
| `browser_path` | No |  | Explicit browser executable path |
| `commit_message` | No | `chore: update README screenshot` | Commit message |
| `git_user_name` | No | `github-actions[bot]` | Git author name |
| `git_user_email` | No | `41898282+github-actions[bot]@users.noreply.github.com` | Git author email |
| `target_branch` | No | current branch | Push the generated commit to this branch instead of the checked-out branch |
| `token` | No | `${{ github.token }}` | Token used for push authentication |

## Outputs

| Output | Description |
| --- | --- |
| `changed` | `true` if a commit was created |
| `commit_sha` | Commit SHA when changes were pushed |
| `image_path` | The repo-relative asset path that was written |

## Notes

- The action fails if the README markers are missing.
- `marker_name` lets you run the action multiple times against the same Markdown file, as long as each target block uses a distinct marker name.
- Set `push: false` when you want several action invocations to accumulate changes in the same workflow before one final manual commit and push.
- By default it looks for Chrome or Chromium in common GitHub-hosted runner locations.
- The caller workflow must grant `contents: write`.
- `capture_format` controls whether the action writes a `.png` or `.gif`, and `image_path` must use the matching extension.
- `navigation_retries` and `navigation_retry_delay_ms` are useful when the target URL is a local preview server that may not be ready on the first request.
- When using a dedicated `target_branch`, make sure your checkout step fetches that branch or allows creating it on first push.

## Development

```bash
npm install
npm test
npm run build
```
