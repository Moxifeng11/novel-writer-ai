import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
    describeSkipReason,
    executeCommand,
    isObsidianE2EEnabled,
    launchObsidian,
    toObsidianCommandId,
    waitForModalPage,
    waitForPluginLoaded,
    type ObsidianSession,
} from './utils/obsidian-app';
import {
    createMockEnvironment,
    disposeMockEnvironment,
    type MockEnvironment,
} from './utils/mock-ai';
import {
    AGENT_WORKBENCH_VIEW_TYPE,
    createLongProjectViaUi,
    openChapterInFullWriter,
    seedChapter,
    selectWriterStep,
    waitForFile,
} from './utils/e2e-workflow';

/**
 * 按钮状态与重复点击防护。
 *
 * 覆盖：结算按钮 busy 态；步骤按钮同步双击只发一次 AI；
 * 协同「更多工具」连点不叠开多个 Modal；Agent busy 时不再启动新回合。
 * 未配置 OBSIDIAN_PATH 时整组明确跳过。
 */
test.describe('Novel Writer AI · 按钮状态与防重复', () => {
    test.describe.configure({ mode: 'serial' });
    test.skip(!isObsidianE2EEnabled(), describeSkipReason());

    let env: MockEnvironment;
    let session: ObsidianSession;
    let projectId = '';

    test.beforeAll(async () => {
        env = await createMockEnvironment();
        session = await launchObsidian(env.vault);
        session.page.on('pageerror', (error) => {
            console.error('[button-states pageerror]', error.message);
        });
        await waitForPluginLoaded(session.page);
        await session.page.waitForTimeout(2_000);
        projectId = await createLongProjectViaUi(
            session.page,
            `E2E按钮态${Date.now()}`,
        );
    });

    test.afterAll(async () => {
        if (session) await session.close().catch(() => undefined);
        await disposeMockEnvironment(env);
        if (env && process.env.KEEP_E2E_VAULT !== '1') {
            fs.rmSync(env.vault.path, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
        }
    });

    test('结算按钮点击后进入 busy 态并恢复', async () => {
        const { page, vault } = session;
        const seeded = await seedChapter(
            page,
            vault,
            projectId,
            1,
            '结算按钮测试',
            '林玄站在演武台下，掌心的令牌还在发热。',
            {
                status: 'drafting',
                // 无 UPDATE_/NEW_ 指令 → 结算引擎返回 mode=empty，弹窗保持打开，能稳定观察 finally 恢复
                analysisReport: '# 第1章 分析报告\n\n本报告仅记录观察，无有效更新指令。\n',
            },
        );
        await openChapterInFullWriter(page, projectId, seeded.bodyRel, '第1章');
        // 命令层结算入口优先用工作台上下文；同时把正文设为活动文件，
        // 覆盖「设置页/其它 tab 激活时没有 activeFile」的真实用户路径。
        await page.evaluate(async (bodyPath) => {
            const app = (window as unknown as {
                app?: {
                    vault?: { getAbstractFileByPath?: (p: string) => unknown };
                    workspace?: { getLeaf?: (newLeaf?: boolean) => { openFile?: (file: unknown) => Promise<void> } };
                };
            }).app;
            const file = app?.vault?.getAbstractFileByPath?.(bodyPath);
            if (file) await app?.workspace?.getLeaf?.(false)?.openFile?.(file);
        }, seeded.bodyRel);

        // 给 settle 增加固定延迟，确保能观察到 busy 态（测试运行时补丁，不改产品代码）
        await page.evaluate(() => {
            const app = (window as unknown as {
                app?: { plugins?: { plugins?: Record<string, { engineRegistry?: { get: (name: string) => unknown } }> } };
            }).app;
            const plugin = app?.plugins?.plugins?.['novel-writer-ai'];
            const engine = plugin?.engineRegistry?.get('settlementEngine') as {
                settle?: (...args: unknown[]) => Promise<unknown>;
                __nwOriginalSettle?: (...args: unknown[]) => Promise<unknown>;
            } | undefined;
            if (!engine || typeof engine.settle !== 'function' || engine.__nwOriginalSettle) return;
            engine.__nwOriginalSettle = engine.settle.bind(engine);
            engine.settle = async (...args: unknown[]) => {
                await new Promise((resolve) => setTimeout(resolve, 900));
                return engine.__nwOriginalSettle?.(...args);
            };
        });

        expect(await executeCommand(page, toObsidianCommandId('novel-writer-chapter-settlement'))).toBe(true);
        const modalPage = await waitForModalPage(page, 15_000);
        const modal = modalPage.locator('.modal-container').last();
        await expect(modal).toBeVisible();

        // 同步点击并读取：onclick 在首个 await 前已设置 disabled/text
        const initial = await modalPage.evaluate(() => {
            const buttons = Array.from(document.querySelectorAll('.modal-container button')) as HTMLButtonElement[];
            const button = buttons.find((item) => (item.textContent || '').trim() === '执行结算');
            if (!button) return null;
            (window as unknown as { __nwSettlementButton?: HTMLButtonElement }).__nwSettlementButton = button;
            button.click();
            return { disabled: button.disabled, text: (button.textContent || '').trim() };
        });
        expect(initial).toEqual({ disabled: true, text: '结算中...' });

        // 空报告 → 引擎返回 mode=empty → 弹窗不关闭，finally 恢复按钮
        await expect.poll(async () => modalPage.evaluate(() => {
            const button = (window as unknown as { __nwSettlementButton?: HTMLButtonElement }).__nwSettlementButton;
            return button
                ? { disabled: button.disabled, text: (button.textContent || '').trim() }
                : null;
        }), { timeout: 20_000 }).toEqual({ disabled: false, text: '执行结算' });

        await modal.locator('.modal-close-button').click({ timeout: 5_000 }).catch(async () => {
            await modalPage.keyboard.press('Escape').catch(() => undefined);
        });

        // 还原 settle
        await page.evaluate(() => {
            const app = (window as unknown as {
                app?: { plugins?: { plugins?: Record<string, { engineRegistry?: { get: (name: string) => unknown } }> } };
            }).app;
            const engine = app?.plugins?.plugins?.['novel-writer-ai']?.engineRegistry?.get('settlementEngine') as {
                settle?: (...args: unknown[]) => Promise<unknown>;
                __nwOriginalSettle?: (...args: unknown[]) => Promise<unknown>;
            } | undefined;
            if (engine?.__nwOriginalSettle) {
                engine.settle = engine.__nwOriginalSettle;
                delete engine.__nwOriginalSettle;
            }
        });
    });

    test('步骤按钮同步双击只触发一次 AI 调用', async () => {
        const { page, vault } = session;
        const seeded = await seedChapter(
            page,
            vault,
            projectId,
            2,
            '双击防护测试',
            '林玄抬头看着演武台，等待铜钟响起。',
            { status: 'drafting' },
        );
        await openChapterInFullWriter(page, projectId, seeded.bodyRel, '第2章');
        await selectWriterStep(page, 'infoPlan');

        await env.server.resetStats();

        const clicked = await page.evaluate(() => {
            const button = document.querySelector('.nw-step-action-primary') as HTMLButtonElement | null;
            if (!button) return false;
            // 同一任务内连续两次 click：第一次在首个 await 前已置 isLoading，
            // 第二次会命中 executeCurrentStep 的 isLoading 守卫。
            button.click();
            button.click();
            return true;
        });
        expect(clicked).toBe(true);

        const stepFile = path.join(seeded.stepAbs, '第2章_信息规划.md');
        await waitForFile(stepFile, 30_000);
        // 给潜在的第二次调用留出窗口
        await page.waitForTimeout(800);

        const stats = await env.server.stats();
        expect(stats.byKind.infoPlan || 0).toBe(1);
        expect(fs.readFileSync(stepFile, 'utf8')).toContain('## 章名与核心冲突');
    });

    test('协同「更多工具」连点不叠开多个 Modal', async () => {
        const { page, vault } = session;
        const seeded = await seedChapter(
            page,
            vault,
            projectId,
            3,
            '工具重复点击测试',
            '林玄站在演武台边，掌心的令牌还热着。他抬头看向远处，山风把旗面吹得猎猎作响。',
            { status: 'drafting' },
        );

        await page.evaluate(async ({ project, chapter }) => {
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
                chapter,
                '第1卷',
                3,
            );
        }, { project: projectId, chapter: '第3章' });

        // 确保绑定的是第3章正文（bodyRel 仅用于 seedChapter 的磁盘文件）
        expect(fs.existsSync(seeded.bodyAbs)).toBe(true);
        const toolsToggle = page.locator('.nw-cowrite-tools-toggle').first();
        await expect(toolsToggle).toBeVisible({ timeout: 30_000 });
        await toolsToggle.click();

        const clicked = await page.evaluate(() => {
            const buttons = Array.from(document.querySelectorAll('.nw-cowrite-tools-panel button')) as HTMLButtonElement[];
            const button = buttons.find((item) => (item.textContent || '').includes('历史'));
            if (!button) return false;
            button.click();
            button.click();
            return true;
        });
        expect(clicked).toBe(true);

        const modalPage = await waitForModalPage(page, 15_000);
        // 可能渲染在独立窗口：统计所有页面里的 modal-container
        const counts = await Promise.all(
            page.context().pages().map((candidate) => candidate.evaluate(
                () => document.querySelectorAll('.modal-container').length,
            ).catch(() => 0)),
        );
        const total = counts.reduce((sum, count) => sum + count, 0);
        expect(total).toBe(1);

        await modalPage.locator('.modal-container').last()
            .locator('.modal-close-button')
            .click({ timeout: 5_000 })
            .catch(async () => {
                await modalPage.keyboard.press('Escape').catch(() => undefined);
            });
    });

    test('Agent busy 时再次发送不会启动新回合', async () => {
        const { page } = session;
        expect(await executeCommand(page, toObsidianCommandId('novel-writer-agent-guide'))).toBe(true);

        const workbench = page.locator(`.workspace-leaf-content[data-type="${AGENT_WORKBENCH_VIEW_TYPE}"]`);
        await expect(workbench).toBeVisible({ timeout: 20_000 });
        const composer = workbench.locator('textarea.nw-awb-input');
        const sendButton = workbench.locator('.nw-awb-send');
        await expect(composer).toBeVisible({ timeout: 10_000 });
        await expect(sendButton).toBeVisible();

        // 运行时包装 runTurn：同步置 busy 并阻塞，稳定制造 busy 窗口
        const wrapped = await page.evaluate(() => {
            const app = (window as unknown as {
                app?: { workspace?: { getLeavesOfType?: (type: string) => Array<{ view?: unknown }> } };
            }).app;
            const leaf = app?.workspace?.getLeavesOfType?.('novel-writer-agent-workbench')?.[0];
            const view = leaf?.view as {
                runTurn?: (text: string) => Promise<void>;
                busy?: boolean;
                __nwTurnCount?: number;
                __nwReleaseTurn?: () => void;
                __nwWrapped?: boolean;
            } | undefined;
            if (!view?.runTurn || view.__nwWrapped) return false;
            const original = view.runTurn.bind(view);
            view.__nwWrapped = true;
            view.__nwTurnCount = 0;
            view.runTurn = async function wrappedRunTurn(this: typeof view, text: string) {
                this.__nwTurnCount = (this.__nwTurnCount || 0) + 1;
                this.busy = true;
                try {
                    await new Promise<void>((resolve) => {
                        this.__nwReleaseTurn = resolve;
                    });
                    return await original(text);
                } finally {
                    this.busy = false;
                }
            };
            return true;
        });
        expect(wrapped).toBe(true);

        await composer.fill('你好，帮我看看当前项目。');
        await sendButton.click();

        await page.waitForFunction(() => {
            const app = (window as unknown as {
                app?: { workspace?: { getLeavesOfType?: (type: string) => Array<{ view?: unknown }> } };
            }).app;
            const view = app?.workspace?.getLeavesOfType?.('novel-writer-agent-workbench')?.[0]?.view as { busy?: boolean } | undefined;
            return view?.busy === true;
        }, undefined, { timeout: 10_000 });

        const firstState = await page.evaluate(() => {
            const app = (window as unknown as {
                app?: { workspace?: { getLeavesOfType?: (type: string) => Array<{ view?: unknown }> } };
            }).app;
            const view = app?.workspace?.getLeavesOfType?.('novel-writer-agent-workbench')?.[0]?.view as {
                busy?: boolean;
                __nwTurnCount?: number;
            } | undefined;
            return { busy: view?.busy === true, turnCount: view?.__nwTurnCount || 0 };
        });
        expect(firstState).toEqual({ busy: true, turnCount: 1 });

        // busy 中再次发送：不应启动第二个 runTurn（输入被吸收/拒绝）
        await composer.fill('再发一条，看看会不会开新回合。');
        await sendButton.click();
        await page.waitForTimeout(400);

        const secondState = await page.evaluate(() => {
            const app = (window as unknown as {
                app?: { workspace?: { getLeavesOfType?: (type: string) => Array<{ view?: unknown }> } };
            }).app;
            const view = app?.workspace?.getLeavesOfType?.('novel-writer-agent-workbench')?.[0]?.view as {
                busy?: boolean;
                __nwTurnCount?: number;
                __nwReleaseTurn?: () => void;
                __nwOriginalRunTurn?: unknown;
            } | undefined;
            return {
                busy: view?.busy === true,
                turnCount: view?.__nwTurnCount || 0,
            };
        });
        expect(secondState.busy).toBe(true);
        expect(secondState.turnCount).toBe(1);

        // 释放挂起的回合，让视图回到空闲
        await page.evaluate(() => {
            const app = (window as unknown as {
                app?: { workspace?: { getLeavesOfType?: (type: string) => Array<{ view?: unknown }> } };
            }).app;
            const view = app?.workspace?.getLeavesOfType?.('novel-writer-agent-workbench')?.[0]?.view as {
                __nwReleaseTurn?: () => void;
            } | undefined;
            view?.__nwReleaseTurn?.();
        });
    });
});
