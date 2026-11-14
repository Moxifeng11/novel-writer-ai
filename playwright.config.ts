import { defineConfig, devices } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * 轻量 .env 装载（DSH-20261114 e2e-infra）：读取仓库根目录 .env（KEY=VALUE），
 * 已设置的 shell 变量优先。不引入 dotenv 依赖；样例见 .env.example。
 */
(function loadDotEnv(): void {
    const envPath = path.resolve(__dirname, '.env');
    if (!fs.existsSync(envPath)) return;
    for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
        const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
        if (!match) continue;
        const key = match[1];
        const value = match[2].replace(/^["']|["']$/g, '');
        if (process.env[key] === undefined) process.env[key] = value;
    }
})();

export default defineConfig({
  testDir: './tests/e2e',
  /* C-9：E2E 前校验构建产物新鲜度，防止静默跑在旧 main.js/styles.css 上 */
  globalSetup: './tests/e2e/global-setup.ts',
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
      name: 'mode-journey',
      testMatch: /mode-journey\.spec\.ts/,
      timeout: 180_000,
    },

    {
      name: 'review-fixes',
      testMatch: /review-fixes\.spec\.ts/,
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

    /* 阶段4 关键路径冒烟：一键生成 / 事实库视图 / 一致性审核弹窗（DSH-20261114-08 后常态化） */
    {
      name: 'key-paths',
      testMatch: /key-paths-.*\.spec\.ts/,
      timeout: 240_000,
    },

    /* 阶段2 注入链路验证：真实项目 + mock AI，断言事实库/人物卡字段进了 prompt */
    {
      name: 'stage2-injection',
      testMatch: /stage2-injection-validation\.spec\.ts/,
      timeout: 300_000,
    },

    {
      name: 'settings-regroup',
      testMatch: /settings-regroup\.spec\.ts/,
      timeout: 180_000,
    },

    /* 真实 AI 链路：打开真实 vault、消耗 API 额度，默认跳过（需 E2E_REAL_AI=1） */
    {
      name: 'real-ai',
      testMatch: /real-ai\.spec\.ts/,
      timeout: 55 * 60_000,
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
