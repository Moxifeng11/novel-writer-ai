/**
 * key-paths-oneshot.spec.ts — 关键路径冒烟：一键生成（DSH-20261114 e2e-infra ②）
 *
 * 冒烟口径：创建长篇项目 → 打开工作台 → 一键跑完单章（mock AI，确定性响应）
 * → 磁盘断言步骤结果与正文落盘 + mock server 确实收到请求。
 * 全旅程细节（导出/禁用启用/结算断言）由 full-journey.spec 覆盖，这里只做
 * 「命令可达 → AI 被调用 → 产物落盘」的冒烟环。
 */
import type { Page } from '@playwright/test';
import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
    createTestVault,
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
import {
    createLongProjectViaUi,
    openChapterInFullWriter,
    runChapterFromWorkbench,
    seedChapter,
    seedCharacterViaVault,
} from './utils/e2e-workflow';

test.describe('关键路径 · 一键生成冒烟（mock AI）', () => {
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

    test('创建项目 → 一键单章 → 步骤结果与正文落盘，AI 被真实调用', async () => {
        const session = await launchObsidian(env.vault);
        try {
            const { page } = session;
            page.on('pageerror', (error) => console.error('[oneshot pageerror]', error.message));
            await waitForPluginLoaded(page);
            await page.waitForTimeout(2_500);

            const projectName = `E2E冒烟${Date.now()}`;
            const projectId = await createLongProjectViaUi(page, projectName);
            await seedCharacterViaVault(page, projectId);
            const seeded = await seedChapter(page, env.vault, projectId, 1, '冒烟章', '第一章初始占位，等待 AI 生成。');
            await openChapterInFullWriter(page, projectId, seeded.bodyRel, '第1章');

            const completed = await runChapterFromWorkbench(page, 'step');
            expect(completed.length, '至少完成一个 AI 步骤').toBeGreaterThan(0);

            // 磁盘断言：规划与正文产物落盘
            const chapterDir = path.join(env.vault.path, projectId, '03-大纲与章节', '步骤结果', '第1卷', '第1章');
            expect(fs.existsSync(path.join(chapterDir, '第1章_信息规划.md')), '信息规划落盘').toBe(true);
            expect(fs.existsSync(path.join(chapterDir, '第1章_大纲摘要.md')), '大纲摘要落盘').toBe(true);

            const bodyDirs = path.join(env.vault.path, projectId, '03-大纲与章节');
            const bodyFile = findFileRecursive(bodyDirs, '第1章_正文.md');
            expect(bodyFile, '正文落盘').toBeTruthy();
            const bodyContent = bodyFile ? fs.readFileSync(bodyFile, 'utf8') : '';
            expect(bodyContent.length).toBeGreaterThan(50);

            // mock server 确实收到请求（不是缓存/空跑）
            const stats = await env.server.stats();
            expect(stats.total).toBeGreaterThan(0);
        } finally {
            await session.close().catch(() => undefined);
        }
    });
});

/** 递归找文件（正文按卷存放，卷号随创建流程） */
function findFileRecursive(root: string, fileName: string): string | null {
    if (!fs.existsSync(root)) return null;
    const stack = [root];
    while (stack.length > 0) {
        const current = stack.pop()!;
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
            const full = path.join(current, entry.name);
            if (entry.isDirectory()) stack.push(full);
            else if (entry.name === fileName) return full;
        }
    }
    return null;
}
