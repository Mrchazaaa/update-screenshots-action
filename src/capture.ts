import { chromium, type Page } from "playwright-core";
import { access, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import GIFEncoder from "gif-encoder-2";
import { PNG } from "pngjs";
import { retry, type CaptureFormat, type WaitUntil } from "./lib";

const DEFAULT_GIF_FPS = 10;

export type CaptureOptions = {
  browserExecutable: string;
  url: string;
  assetAbsolutePath: string;
  captureFormat: CaptureFormat;
  viewportWidth: number;
  viewportHeight: number;
  waitUntil: WaitUntil;
  navigationRetries: number;
  navigationRetryDelayMs: number;
  delayMs: number;
  gifDurationMs: number;
  onRetry?: (attemptNumber: number, error: unknown) => void;
};

export async function findBrowserExecutable(explicitPath?: string): Promise<string> {
  const candidates = explicitPath
    ? [explicitPath]
    : [
        process.env.CHROME_BIN,
        "/usr/bin/google-chrome",
        "/usr/bin/google-chrome-stable",
        "/usr/bin/chromium-browser",
        "/usr/bin/chromium"
      ];

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }

    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      continue;
    }
  }

  throw new Error(
    "Could not find a Chrome or Chromium executable. Set the browser_path input if your runner uses a custom location."
  );
}

export async function captureAsset(options: CaptureOptions): Promise<void> {
  const browser = await chromium.launch({
    executablePath: options.browserExecutable,
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"]
  });

  try {
    const page = await browser.newPage({
      viewport: {
        width: options.viewportWidth,
        height: options.viewportHeight
      }
    });

    await retry(
      async () => {
        await page.goto(options.url, { waitUntil: options.waitUntil });
      },
      {
        retries: options.navigationRetries,
        delayMs: options.navigationRetryDelayMs,
        onRetry: options.onRetry
      }
    );

    if (options.delayMs > 0) {
      await page.waitForTimeout(options.delayMs);
    }

    if (options.captureFormat === "gif") {
      await captureGif(page, options);
      return;
    }

    await page.screenshot({ path: options.assetAbsolutePath, type: "png", fullPage: false });
  } finally {
    await browser.close();
  }
}

async function captureGif(page: Page, options: CaptureOptions): Promise<void> {
  const frameDelayMs = Math.max(1000 / DEFAULT_GIF_FPS, 20);
  const frameCount = Math.max(1, Math.ceil(options.gifDurationMs / frameDelayMs));
  const encoder = new GIFEncoder(options.viewportWidth, options.viewportHeight, "neuquant", true, frameCount);

  encoder.start();
  encoder.setRepeat(0);
  encoder.setDelay(frameDelayMs);
  encoder.setQuality(10);

  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    const screenshotBuffer = (await page.screenshot({ type: "png", fullPage: false })) as Buffer;
    const png = PNG.sync.read(screenshotBuffer);
    encoder.addFrame(png.data);

    if (frameIndex < frameCount - 1) {
      await page.waitForTimeout(frameDelayMs);
    }
  }

  encoder.finish();
  await writeFile(options.assetAbsolutePath, encoder.out.getData());
}
