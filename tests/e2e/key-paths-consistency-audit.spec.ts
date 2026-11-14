/**
 * key-paths-consistency-audit.spec.ts — 关键路径：一致性审核弹窗（DSH-20261114 e2e-infra ②）
 *
 * 跨章一致性审核（S1 断言层规则检查 + 可选 LLM 复核）此前只有单测，真实
 * Obsidian 里的「命令 → 弹窗 → 自动运行 → 摘要落盘」链路无护栏。本 spec 锁定：
 * 命令打开弹窗（需要 active project）→ 自动审核产出摘要 → 矛盾.json 落盘。
 * 注意：Modal 渲染在独立 about:blank 窗口（Obsidian 1.14），用 waitForModalPage。
 */
import type { Page } from '@playwright/test';
import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
    describeSkipReason,
    isObsidianE2EEnabled,
    launchObsidian,
    waitForPluginLoaded,
} from './utils/obsidian-app';
import {
    createMockEnvironment,
    disposeMockEnvironment,
    type MockEnvironment,
} from './utils/mock-ai';
import { createLongProjectViaUi, openChapterInFullWriter, seedChapter, seedCharacterViaVault } from './utils/e2e-workflow';


/**
 * 找到承载指定特征元素的弹窗窗口页（比 waitForModalPage 更准：
 * 首启欢迎弹窗/创建弹窗/设置窗口都可能带 .modal-container，按本弹窗
 * 的独有类名匹配才不会拿错窗口）。
 */
async function waitForModalWith(anchor: Page, selector: string, timeout = 15_000): Promise<Page> {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        for (const candidate of anchor.context().pages()) {
            const hit = await candidate.evaluate((sel) => Boolean(document.querySelector(sel)), selector)
                .catch(() => false);
            if (hit) return candidate;
        }
        await anchor.waitForTimeout(200);
    }
    throw new Error(`未找到承载 ${selector} 的弹窗窗口`);
}

test.describe('关键路径 · 跨章一致性审核弹窗', () => {
    test.skip(!isObsidianE2EEnabled(), describeSkipReason());

    let env: MockEnvironment;

    test.beforeAll(async () => {
        env = await createMockEnvironment();
    });

    test.afterAll(async () => {
        await disposeMockEnvironment(env);
        if (env && process.env.KEEP_E2E_VAULT !== '1') {
            fs.rmSync(env.vault.path, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
        }
    });

    test('命令打开弹窗 → 自动审核产出摘要 → 矛盾.json 落盘', async () => {
        const session = await launchObsidian(env.vault);
        try {
            const { page } = session;
            await waitForPluginLoaded(page);
            await page.waitForTimeout(2_000);

            // active project：审核弹门严格要求 getActiveProject()（无唯一项目兜底）
            const projectId = await createLongProjectViaUi(page, `E2E审核${Date.now()}`);
            await seedCharacterViaVault(page, projectId);
            const seeded = await seedChapter(page, env.vault, projectId, 1, '审核章', '第一章初始占位。');
            await openChapterInFullWriter(page, projectId, seeded.bodyRel, '第1章');

            // 命令入口（Modal 独立窗口）
            await page.evaluate((id) => {
                (window as unknown as { app: { commands: { executeCommandById: (id: string) => boolean } } })
                    .app.commands.executeCommandById(id);
            }, 'novel-writer-ai:novel-writer-consistency-audit');
            const modalPage = await waitForModalWith(page, '.nw-consistency-modal');

            const modal = modalPage.locator('.nw-consistency-modal');
            await expect(modal).toBeVisible({ timeout: 10_000 });
            await expect(modal.locator('.nw-consistency-subtitle')).toContainText('项目：');

            // 自动审核（S1 规则层，无 AI 成本）：摘要与状态最终非空
            await expect(modal.locator('.nw-consistency-summary')).not.toHaveText('', { timeout: 60_000 });

            // 报告落盘（外部排查通道）
            const reportPath = path.join(env.vault.path, projectId, '04-项目总控', '一致性审核', '矛盾.json');
            await expect.poll(() => fs.existsSync(reportPath), { timeout: 30_000 }).toBe(true);
        } finally {
            await session.close().catch(() => undefined);
        }
    });
});
