import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';
import {
    describeSkipReason,
    isObsidianE2EEnabled,
    launchObsidian,
    waitForPluginLoaded,
    type ObsidianSession,
} from './utils/obsidian-app';
import {
    createMockEnvironment,
    disposeMockEnvironment,
    type MockEnvironment,
} from './utils/mock-ai';
import {
    CO_WRITING_VIEW_TYPE,
    MONITOR_A_VIEW_TYPE,
    createLongProjectViaUi,
    seedChapter,
} from './utils/e2e-workflow';

/**
 * 视图生命周期与并发切换。
 *
 * 覆盖：生成中关闭协同视图无未捕获错误；快速连切两章最终绑定后一章；
 * 监控面板关闭后再次打开正常。
 * 未配置 OBSIDIAN_PATH 时整组明确跳过。
 */
test.describe('Novel Writer AI · 视图生命周期', () => {
    test.describe.configure({ mode: 'serial' });
    test.skip(!isObsidianE2EEnabled(), describeSkipReason());

    let env: MockEnvironment;
    let session: ObsidianSession;
    let projectId = '';

    test.beforeAll(async () => {
        env = await createMockEnvironment();
        session = await launchObsidian(env.vault);
        session.page.on('pageerror', (error) => {
            console.error('[view-lifecycle pageerror]', error.message);
        });
        await waitForPluginLoaded(session.page);
        await session.page.waitForTimeout(2_000);

        projectId = await createLongProjectViaUi(session.page, `E2E视图${Date.now()}`);
        await seedChapter(
            session.page,
            env.vault,
            projectId,
            1,
            '生命周期第一章',
            '第一章独有标记：林玄站在演武台下，掌心的令牌还热着。',
            { status: 'drafting' },
        );
        await seedChapter(
            session.page,
            env.vault,
            projectId,
            2,
            '生命周期第二章',
            '第二章独有标记：林玄走进藏经阁，天窗的光落在旧书上。',
            { status: 'drafting' },
        );
    });

    test.afterAll(async () => {
        if (session) await session.close().catch(() => undefined);
        await disposeMockEnvironment(env);
        if (env && process.env.KEEP_E2E_VAULT !== '1') {
            fs.rmSync(env.vault.path, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
        }
    });

    test('生成中关闭协同视图不产生未捕获错误', async () => {
        const { page } = session;
        const pageErrors: string[] = [];
        const onPageError = (error: Error): void => { pageErrors.push(error.message); };
        page.on('pageerror', onPageError);

        await env.server.setDelay(1_500);
        try {
            await page.evaluate(async ({ project }) => {
                const app = (window as unknown as {
                    app?: {
                        plugins?: {
                            plugins?: Record<string, {
                                activateCoWritingView?: (p: string, c: string, v: string, n: number) => Promise<void>;
                            }>;
                        };
                    };
                }).app;
                await app?.plugins?.plugins?.['novel-writer-ai']?.activateCoWritingView?.(
                    project,
                    '第1章',
                    '第1卷',
                    1,
                );
            }, { project: projectId });

            const suggestButton = page.locator('.nw-cowrite-action-row button').filter({ hasText: '建议' }).first();
            await expect(suggestButton).toBeVisible({ timeout: 30_000 });
            await suggestButton.click();

            // 等待建议请求真正进入在途状态
            await page.waitForFunction(() => {
                const app = (window as unknown as {
                    app?: { workspace?: { getLeavesOfType?: (type: string) => Array<{ view?: unknown }> } };
                }).app;
                const view = app?.workspace?.getLeavesOfType?.('novel-writer-co-writing')?.[0]?.view as {
                    isSuggesting?: boolean;
                } | undefined;
                return view?.isSuggesting === true;
            }, undefined, { timeout: 10_000 });

            // 生成中直接关闭协同视图（onClose 应 abort 在途请求并清理 DOM/定时器）
            await page.evaluate(() => {
                const app = (window as unknown as {
                    app?: { workspace?: { getLeavesOfType?: (type: string) => Array<{ detach?: () => void }> } };
                }).app;
                for (const leaf of app?.workspace?.getLeavesOfType?.('novel-writer-co-writing') || []) {
                    leaf.detach?.();
                }
            });

            await page.waitForTimeout(2_500);
            expect(pageErrors, `关闭时出现未捕获错误：${pageErrors.join(' | ')}`).toEqual([]);
        } finally {
            await env.server.setDelay(0).catch(() => undefined);
            page.off('pageerror', onPageError);
        }
    });

    test('快速连切两章最终绑定后一章', async () => {
        const { page } = session;
        const pageErrors: string[] = [];
        const onPageError = (error: Error): void => { pageErrors.push(error.message); };
        page.on('pageerror', onPageError);

        try {
            const result = await page.evaluate(async ({ project }) => {
                const app = (window as unknown as {
                    app?: {
                        workspace?: { getLeavesOfType?: (type: string) => Array<{ view?: unknown }> };
                        plugins?: {
                            plugins?: Record<string, {
                                activateCoWritingView?: (p: string, c: string, v: string, n: number) => Promise<void>;
                            }>;
                        };
                    };
                }).app;
                await app?.plugins?.plugins?.['novel-writer-ai']?.activateCoWritingView?.(
                    project,
                    '第1章',
                    '第1卷',
                    1,
                );
                const leaf = app?.workspace?.getLeavesOfType?.('novel-writer-co-writing')?.[0];
                const view = leaf?.view as {
                    openChapter?: (p: string, c: string, v: string, n: number) => Promise<void>;
                    chapterName?: string;
                    chapterNum?: number;
                    rightEditor?: HTMLTextAreaElement;
                } | undefined;
                if (!view?.openChapter) throw new Error('未找到协同写作视图');
                const first = view.openChapter(project, '第1章', '第1卷', 1);
                const second = view.openChapter(project, '第2章', '第1卷', 2);
                await Promise.allSettled([first, second]);
                return {
                    chapterName: view.chapterName || '',
                    chapterNum: view.chapterNum || 0,
                    editor: view.rightEditor?.value || '',
                };
            }, { project: projectId });

            expect(result.chapterName).toBe('第2章');
            expect(result.chapterNum).toBe(2);
            expect(result.editor).toContain('第二章独有标记');
            expect(pageErrors, `连切章节出现未捕获错误：${pageErrors.join(' | ')}`).toEqual([]);
        } finally {
            page.off('pageerror', onPageError);
        }
    });

    test('监控面板关闭后再次打开正常', async () => {
        const { page } = session;
        const pageErrors: string[] = [];
        const onPageError = (error: Error): void => { pageErrors.push(error.message); };
        page.on('pageerror', onPageError);

        try {
            await page.evaluate(async ({ project }) => {
                const app = (window as unknown as {
                    app?: {
                        workspace?: { getLeavesOfType?: (type: string) => Array<{ detach?: () => void }> };
                        plugins?: {
                            plugins?: Record<string, {
                                activateCoWritingView?: (p: string, c: string, v: string, n: number) => Promise<void>;
                            }>;
                        };
                    };
                }).app;
                await app?.plugins?.plugins?.['novel-writer-ai']?.activateCoWritingView?.(
                    project,
                    '第1章',
                    '第1卷',
                    1,
                );
            }, { project: projectId });

            await page.waitForFunction((viewType) => {
                const app = (window as unknown as {
                    app?: { workspace?: { getLeavesOfType?: (type: string) => unknown[] } };
                }).app;
                return (app?.workspace?.getLeavesOfType?.(viewType)?.length || 0) > 0;
            }, MONITOR_A_VIEW_TYPE, { timeout: 20_000 });

            // 关闭监控面板 A
            await page.evaluate((viewType) => {
                const app = (window as unknown as {
                    app?: { workspace?: { getLeavesOfType?: (type: string) => Array<{ detach?: () => void }> } };
                }).app;
                for (const leaf of app?.workspace?.getLeavesOfType?.(viewType) || []) {
                    leaf.detach?.();
                }
            }, MONITOR_A_VIEW_TYPE);
            await page.waitForTimeout(400);

            // 再次打开：openAll 应补建缺失面板
            const reopened = await page.evaluate(async (viewType) => {
                const app = (window as unknown as {
                    app?: {
                        workspace?: { getLeavesOfType?: (type: string) => unknown[] };
                        plugins?: {
                            plugins?: Record<string, {
                                workspaceManager?: { openAll?: () => Promise<void> };
                            }>;
                        };
                    };
                }).app;
                await app?.plugins?.plugins?.['novel-writer-ai']?.workspaceManager?.openAll?.();
                return (app?.workspace?.getLeavesOfType?.(viewType)?.length || 0);
            }, MONITOR_A_VIEW_TYPE);

            expect(reopened).toBe(1);
            const viewType = await page.evaluate((targetType) => {
                const app = (window as unknown as {
                    app?: { workspace?: { getLeavesOfType?: (type: string) => Array<{ view?: { getViewType?: () => string } }> } };
                }).app;
                return app?.workspace?.getLeavesOfType?.(targetType)?.[0]?.view?.getViewType?.() || '';
            }, MONITOR_A_VIEW_TYPE);
            expect(viewType).toBe(MONITOR_A_VIEW_TYPE);
            expect(pageErrors, `监控面板重开出现未捕获错误：${pageErrors.join(' | ')}`).toEqual([]);
        } finally {
            page.off('pageerror', onPageError);
        }
    });
});
