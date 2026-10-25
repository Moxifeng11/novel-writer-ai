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
        await waitForPluginLoaded(session.page);
    });

    test.afterAll(async () => {
        if (!session) return;
        await session.app.close().catch(() => undefined);
        if (process.env.KEEP_E2E_VAULT !== '1') {
            fs.rmSync(session.vault.path, { recursive: true, force: true });
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

        const modal = page.locator('.modal-container').last();
        await expect(modal).toBeVisible();
        await modal.locator('input[placeholder*="项目名称"]').fill(projectName);
        await modal.locator('input[placeholder*="题材"]').fill('玄幻');
        await modal.getByRole('button', { name: '创建项目', exact: true }).click();

        const view = page.locator(`.workspace-leaf-content[data-type="${FULL_WRITER_VIEW_TYPE}"]`);
        await expect(view).toBeVisible({ timeout: 90_000 });

        const projectCard = view.locator(`.novel-writer-fw-project-card[data-project="${projectName}"]`);
        await expect(projectCard).toBeVisible({ timeout: 30_000 });

        expect(fs.existsSync(path.join(vault.path, projectName))).toBe(true);
        expect(fs.existsSync(path.join(vault.path, projectName, '03-大纲与章节'))).toBe(true);
        expect(fs.existsSync(path.join(vault.path, '元文件', '00-系统模板'))).toBe(true);
    });
});
