import { defineConfig, devices } from '@playwright/test';

/**
 * Read environment variables from file.
 * https://github.com/motdotla/dotenv
 */
// require('dotenv').config();

export default defineConfig({
  testDir: './tests/e2e',
  /* Electron 启动与项目模板复制较慢，单测上限放宽 */
  timeout: 180_000,
  /* Run tests in files in parallel */
  fullyParallel: true,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  /* Opt out of parallel tests on CI. */
  workers: process.env.CI ? 1 : undefined,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: [['html'], ['json', { outputFile: 'test-results/results.json' }]],
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL to use in actions like `await page.goto('/')`. */
    // baseURL: 'http://127.0.0.1:3000',

    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'on-first-retry',
    
    /* Screenshot on failure */
    screenshot: 'only-on-failure',
    
    /* Video on failure */
    video: 'retain-on-failure',
  },

  /* 真实链路：Electron 启动 Obsidian；未配置 OBSIDIAN_PATH 时用例内部显式 skip */
  projects: [
    {
      name: 'obsidian-electron',
      testMatch: /obsidian-plugin\.spec\.ts/,
    },

    {
      name: 'lifecycle',
      // 只匹配 lifecycle.spec.ts，避免把 view-lifecycle.spec.ts 一并吸入
      testMatch: /(?<!view-)lifecycle\.spec\.ts$/,
    },

    {
      name: 'perf-smoke',
      testMatch: /perf-smoke\.spec\.ts/,
      timeout: 120_000,
    },

    /* 用户生产环境模拟：真实 Obsidian + 临时 vault + 本地 mock AI（不访问真实 API） */
    {
      name: 'full-journey',
      testMatch: /full-journey\.spec\.ts/,
      timeout: 180_000,
    },

    {
      name: 'button-states',
      testMatch: /button-states\.spec\.ts/,
      timeout: 180_000,
    },

    {
      name: 'view-lifecycle',
      testMatch: /view-lifecycle\.spec\.ts/,
      timeout: 180_000,
    },

    /* 真实 AI 链路：打开真实 vault、消耗 API 额度，默认跳过（需 E2E_REAL_AI=1） */
    {
      name: 'real-ai',
      testMatch: /real-ai\.spec\.ts/,
      timeout: 55 * 60_000,
    },

    /* 真实重写章节：重置并重写真实章节，默认跳过（需 E2E_REWRITE=1） */
    {
      name: 'rewrite-chapters',
      testMatch: /rewrite-chapters\.spec\.ts/,
      timeout: 70 * 60_000,
    },

    /* 浏览器模拟链路已停用，保留 skip 的存量用例用于后续迁移 */
    {
      name: 'legacy-browser',
      testMatch: /(project-creation|project-card-interactions)\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  /* Run your local dev server before starting the tests */
  // webServer: {
  //   command: 'npm run start',
  //   url: 'http://127.0.0.1:3000',
  //   reuseExistingServer: !process.env.CI,
  // },
});
