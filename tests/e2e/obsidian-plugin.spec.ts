import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
    createTestVault,
    describeSkipReason,
    executeCommand,
    isObsidianE2EEnabled,
    launchObsidian,
    toObsidianCommandId,
    waitForModalPage,
    waitForPluginLoaded,
    type ObsidianSession,
} from './utils/obsidian-app';

/**
 * Obsidian 真实 Electron 链路 E2E。
 *
 * 覆盖 PRD §3 的 P0 旅程：创建项目 → 打开完整写作工作台。
 * 运行前需设置 OBSIDIAN_PATH；未配置时整组用例明确跳过，而不是以占位断言“假通过”。
 */

const CREATE_PROJECT_COMMAND = toObsidianCommandId('novel-writer-create-project');
const FULL_WRITER_VIEW_TYPE = 'novel-writer-full-writer';

test.describe('Novel Writer AI · 真实 Electron 链路', () => {
    test.describe.configure({ mode: 'serial' });
    test.skip(!isObsidianE2EEnabled(), describeSkipReason());

    let session: ObsidianSession;

    test.beforeAll(async () => {
        const vault = createTestVault();
        session = await launchObsidian(vault);
        // E2E 失败时把渲染进程异常带回终端，避免只剩一个“modal 不可见”。
        session.page.on('pageerror', (error) => {
            console.error('[E2E pageerror]', error.message);
        });
        session.page.on('console', (message) => {
            if (message.type() === 'error') console.error('[E2E console]', message.text());
        });
        await waitForPluginLoaded(session.page);
        // 插件 onload 会异步自举模板目录；等布局与命令回调稳定后再执行用户旅程。
        await session.page.waitForTimeout(3_000);
    });

    test.afterAll(async () => {
        if (!session) return;
        await session.close().catch(() => undefined);
        if (process.env.KEEP_E2E_VAULT !== '1') {
            fs.rmSync(session.vault.path, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
        }
    });

    test('插件应被 Obsidian 加载并注册命令', async () => {
        const { page } = session;

        const pluginLoaded = await page.evaluate(() => {
            const host = window as unknown as {
                app?: { plugins?: { plugins?: Record<string, unknown> } };
            };
            return Boolean(host.app?.plugins?.plugins?.['novel-writer-ai']);
        });
        expect(pluginLoaded).toBe(true);

        const commandRegistered = await page.evaluate((id) => {
            const host = window as unknown as {
                app?: { commands?: { commands?: Record<string, unknown> } };
            };
            return Boolean(host.app?.commands?.commands?.[id]);
        }, CREATE_PROJECT_COMMAND);
        expect(commandRegistered).toBe(true);
    });

    test('创建项目后应打开完整写作工作台并落盘目录', async () => {
        const { page, vault } = session;
        const projectName = `E2E项目${Date.now()}`;

        expect(await executeCommand(page, CREATE_PROJECT_COMMAND)).toBe(true);

        // Obsidian 1.14 会把 Modal 挂到单独的 about:blank 窗口，不能只在主工作区页面里找。
        const modalPage = await waitForModalPage(page, 15_000);
        const modal = modalPage.locator('.modal-container').last();
        await expect(modal).toBeVisible();
        await modal.locator('input[placeholder*="项目名称"]').fill(projectName);
        await modal.locator('input[placeholder*="题材"]').fill('玄幻');
        await modal.getByRole('button', { name: '创建项目', exact: true }).click();

        const view = page.locator(`.workspace-leaf-content[data-type="${FULL_WRITER_VIEW_TYPE}"]`);
        await expect(view).toBeVisible({ timeout: 90_000 });

        const projectCard = page.locator(`.novel-writer-fw-project-card[data-project="长篇小说/${projectName}"]`);
        await expect(projectCard).toBeVisible({ timeout: 30_000 });

        const projectRoot = path.join(vault.path, '长篇小说', projectName);
        expect(fs.existsSync(projectRoot)).toBe(true);
        expect(fs.existsSync(path.join(projectRoot, '03-大纲与章节'))).toBe(true);
        expect(fs.existsSync(path.join(vault.path, '元文件', '00-系统模板'))).toBe(true);

        // 无需 AI：写入一个最小正文，进入章节步骤页验证本轮交互改版。
        const projectId = `长篇小说/${projectName}`;
        const bodyPath = `${projectId}/03-大纲与章节/正文/第1卷/第1章_正文.md`;
        await page.evaluate(async ({ projectId: pid, bodyPath: target }) => {
            const host = window as unknown as {
                app?: {
                    vault?: {
                        adapter?: { mkdir?: (path: string) => Promise<void> };
                        create?: (path: string, content: string) => Promise<unknown>;
                    };
                    plugins?: { plugins?: Record<string, { openChapterInFullWriter?: (project: string, path: string) => void }> };
                };
            };
            const vault = host.app?.vault;
            const folder = target.split('/').slice(0, -1).join('/');
            for (const dir of [folder]) {
                await vault?.adapter?.mkdir?.(dir).catch(() => undefined);
            }
            await vault?.create?.(target, '---\nstatus: drafting\n---\n\n# 第1章\n\nE2E 正文占位。\n');
            host.app?.plugins?.plugins?.['novel-writer-ai']?.openChapterInFullWriter?.(pid, target);
        }, { projectId, bodyPath });

        const stepArea = page.locator('.novel-writer-fw-prompt-area');
        await expect(stepArea).toBeVisible({ timeout: 30_000 });
        await expect(page.locator('.nw-step-actionbar')).toBeVisible();
        await expect(page.locator('.nw-exec-timeline')).toBeVisible();
        await expect(page.locator('details.nw-prompt-collapsible')).toHaveCount(2);
        expect(await page.locator('details.nw-prompt-collapsible[open]').count()).toBe(0);
    });
});
