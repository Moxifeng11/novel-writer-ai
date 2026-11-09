import { test, expect } from '@playwright/test';
import {
    createTestVault,
    describeSkipReason,
    isObsidianE2EEnabled,
    launchObsidian,
    waitForPluginLoaded,
    type ObsidianSession,
} from './utils/obsidian-app';

/**
 * 4.81.0 社区审核修复的真实运行时回归。
 *
 * 三条断言对应本轮最容易「单测绿、真实环境炸」的改动：
 *  1. 右栏折叠后打开「项目速览」必须可见（revealLeafCompat 的 expand+setActiveLeaf）；
 *  2. 两个 Modal 连续开关两次无 pageerror（自管 Component 渲染宿主的 load/unload）；
 *  3. 打开期间页面错误为 0。
 * 未配置 OBSIDIAN_PATH 时整组明确跳过。
 */
test.describe('4.81.0 审核修复 · 真实 Obsidian', () => {
    test.describe.configure({ mode: 'serial' });
    test.skip(!isObsidianE2EEnabled(), describeSkipReason());

    let session: ObsidianSession;
    const pageErrors: string[] = [];

    test.beforeAll(async () => {
        const vault = createTestVault();
        session = await launchObsidian(vault);
        session.page.on('pageerror', (error) => pageErrors.push(error.message));
        session.page.on('console', (message) => {
            if (message.type() === 'error') pageErrors.push(`console: ${message.text()}`);
        });
        await waitForPluginLoaded(session.page);
        await session.page.waitForTimeout(1_500);
    });

    test.afterAll(async () => {
        if (session) await session.close().catch(() => undefined);
    });

    async function pagesWithText(anchor: import('playwright').Page, text: string): Promise<import('playwright').Page[]> {
        const hits: import('playwright').Page[] = [];
        for (const page of anchor.context().pages()) {
            if (page.isClosed()) continue;
            const found = await page.evaluate(
                (needle) => (document.body?.innerText || '').includes(needle),
                text,
            ).catch(() => false);
            if (found) hits.push(page);
        }
        return hits;
    }

    async function closeTopModal(page: import('playwright').Page): Promise<void> {
        await page.bringToFront().catch(() => undefined);
        // Obsidian 的关闭按钮类名随版本变化（.modal-close-button / .modal-header-button），
        // Escape 是 Modal 的基础交互，跨版本更稳。
        await page.keyboard.press('Escape');
    }

    /** 打开 → 标题可见 → 关闭 → 标题消失；返回观测到的弹窗页面数 */
    async function openAndCloseModal(
        page: import('playwright').Page,
        title: string,
        open: () => Promise<void>,
    ): Promise<void> {
        await open();
        await expect.poll(async () => (await pagesWithText(page, title)).length, { timeout: 10_000 })
            .toBeGreaterThan(0);

        const modalPage = (await pagesWithText(page, title)).at(-1);
        expect(modalPage).toBeTruthy();
        modalPage!.on('pageerror', (error) => pageErrors.push(error.message));
        await modalPage!.waitForTimeout(400);

        await closeTopModal(modalPage!);
        await modalPage!.waitForTimeout(800);
        await expect.poll(async () => (await pagesWithText(page, title)).length, { timeout: 10_000 })
            .toBe(0);
    }

    test('右栏折叠后打开项目速览，侧栏展开且 leaf 可见', async () => {
        const { page } = session;

        await page.evaluate(() => {
            const workspace = (window as unknown as {
                app: { workspace: { rightSplit: { collapse?: () => void } } };
            }).app.workspace;
            workspace.rightSplit.collapse?.();
        });

        await page.evaluate(() => {
            const host = window as unknown as {
                app: { commands: { executeCommandById: (id: string) => boolean } };
            };
            host.app.commands.executeCommandById('novel-writer-ai:novel-writer-project-side-panel');
        });

        await expect.poll(async () => page.evaluate(() => {
            const host = window as unknown as {
                app: { workspace: {
                    getLeavesOfType: (type: string) => Array<{ view: { containerEl: HTMLElement } }>;
                    rightSplit: { collapsed?: boolean };
                } };
            };
            const { workspace } = host.app;
            const leaves = workspace.getLeavesOfType('novel-writer-project-side-panel');
            const leaf = leaves[0];
            const rect = leaf?.view?.containerEl?.getBoundingClientRect();
            return {
                count: leaves.length,
                collapsed: workspace.rightSplit.collapsed === true,
                visible: Boolean(rect && rect.width > 0 && rect.height > 0),
            };
        }), { timeout: 10_000 }).toEqual({ count: 1, collapsed: false, visible: true });
    });

    test('续写规划 Modal 连续开关两次无 pageerror', async () => {
        const { page } = session;

        for (let round = 0; round < 2; round++) {
            await openAndCloseModal(page, '续写规划', async () => {
                await page.evaluate(() => {
                    const host = window as unknown as {
                        app: { commands: { executeCommandById: (id: string) => boolean } };
                    };
                    host.app.commands.executeCommandById('novel-writer-ai:novel-writer-continue-chapters');
                });
            });
        }

        expect(pageErrors).toEqual([]);
    });

    test('统一实体管理 Modal 连续开关两次无 pageerror', async () => {
        const { page } = session;
        const title = '实体管理';

        for (let round = 0; round < 2; round++) {
            await openAndCloseModal(page, title, async () => {
                await page.evaluate(() => {
                    const host = window as unknown as {
                        app: { plugins: { plugins: Record<string, { openEntityManagerModal?: (project: string) => void }> } };
                    };
                    host.app.plugins.plugins['novel-writer-ai']?.openEntityManagerModal?.('E2E空项目');
                });
            });
        }

        expect(pageErrors).toEqual([]);
    });
});
