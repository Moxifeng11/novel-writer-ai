/**
 * key-paths-fact-store.spec.ts — 关键路径：知识库事实库视图（DSH-20261114 e2e-infra ②）
 *
 * 事实库是「主体·谓词=值」结构化事实的唯一持久源（一致性审核消费，-08① 起
 * 生成侧也消费）。本 spec 锁定：命令 `novel-writer-fact-store` 打开视图 →
 * 事实按主体分组可见 → 文件位置提示可见（用户能找到 JSON 手工修正）。
 * 注意：Modal 渲染在独立 about:blank 窗口（Obsidian 1.14），用 waitForModalPage。
 */
import type { Page } from '@playwright/test';
import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
    executeCommand,
    toObsidianCommandId,
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
import { createLongProjectViaUi } from './utils/e2e-workflow';

/** 最小事实库（serializeFactStore 同构：version/updatedAt/facts） */
function factStoreJson(): string {
    return JSON.stringify({
        version: 1,
        updatedAt: new Date().toISOString(),
        facts: [
            {
                type: 'age', subject: '林玄', predicate: '年龄', value: '十七',
                numeric: 17, unit: '岁', validFrom: 1, validTo: null,
                confidence: 0.95, quote: '林玄今年十七岁', chapter: 1,
            },
            {
                type: 'possession', subject: '林玄', predicate: '持有', value: '神秘令牌',
                validFrom: 1, validTo: null, confidence: 0.9,
                quote: '怀里的令牌是他仅有的遗物', chapter: 1,
            },
        ],
    }, null, 2);
}


/**
 * 找到承载指定特征元素的弹窗窗口页（比 waitForModalPage 更准：
 * 首启欢迎弹窗/创建弹窗/设置窗口都可能带 .modal-container，按本弹窗
 * 的独有类名匹配才不会拿错窗口）。
 */
async function waitForModalWith(anchor: Page, selector: string, timeout = 15_000): Promise<Page> {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        for (const candidate of anchor.context().pages()) {
            const hit = await candidate.evaluate((sel: string) => Boolean(document.querySelector(sel)), selector)
                .catch(() => false);
            if (hit) return candidate;
        }
        await anchor.waitForTimeout(200);
    }
    throw new Error(`未找到承载 ${selector} 的弹窗窗口`);
}

test.describe('关键路径 · 知识库事实库视图', () => {
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

    test('命令打开事实库视图：分组事实与文件位置可见', async () => {
        const session = await launchObsidian(env.vault);
        try {
            const { page } = session;
            await waitForPluginLoaded(page);
            await page.waitForTimeout(2_000);

            const projectId = await createLongProjectViaUi(page, `E2E事实库${Date.now()}`);

            // 事实库落盘（与一致性审核同一路径常量）
            // pjFactStoreFile 真实常量：04-项目总控/一致性审核/事实库.json（与一致性审核同目录）
            const factPath = path.join(env.vault.path, projectId, '04-项目总控', '一致性审核', '事实库.json');
            fs.mkdirSync(path.dirname(factPath), { recursive: true });
            fs.writeFileSync(factPath, factStoreJson(), 'utf8');

            // 命令入口 → Modal（独立窗口）
            const opened = await executeCommand(page, toObsidianCommandId('novel-writer-fact-store'));
            expect(opened, '事实库命令已注册且可执行').toBe(true);
            const modalPage = await waitForModalWith(page, '.nw-fact-store-modal');

            const body = modalPage.locator('.nw-fact-store-body');
            await expect(body).toBeVisible({ timeout: 10_000 });
            // 主体分组与两条事实可见
            await expect(body.locator('.nw-fact-groups')).toBeVisible({ timeout: 10_000 });
            const text = await body.allTextContents();
            const joined = text.join('\n');
            expect(joined).toContain('林玄');
            expect(joined).toContain('年龄');
            expect(joined).toContain('神秘令牌');
            // 文件位置提示（用户能找到 JSON 手工修正）
            expect(joined).toContain('事实库.json');
        } finally {
            await session.close().catch(() => undefined);
        }
    });
});
