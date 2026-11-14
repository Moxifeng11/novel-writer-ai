/**
 * stage2-injection-validation.spec.ts — 阶段2：真实项目端到端「注入链路」验证
 *
 * 目的：验证审计修复的链路**真的进了写作 prompt**，而不是只在单测里成立。
 *
 * 做法（零 AI 成本）：
 *  1. 用 UI 创建真实长篇项目（标准目录结构）
 *  2. 播种三类「此前不进 prompt」的结构化数据：
 *     - 事实库（04-项目总控/一致性审核/事实库.json）：含唯一标记事实
 *     - 人物卡连续性字段（已知信息 / 伤势 / 持有物品 / entity_status）
 *  3. 一键跑完第 1 章（mock AI）
 *  4. 从 mock server 抓取实际发出的 prompt 文本，断言结构化数据出现在 prompt 里
 *  5. 把 prompt 证据落盘到 docs/analysis/，供人工复核
 *
 * 断言失败即说明「接线断了」——这是阶段2 的核心验收。
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
} from './utils/e2e-workflow';

/** 事实库里的唯一标记（出现即证明事实库进了 prompt） */
const FACT_MARKER = '玄铁令';
/** 人物卡连续性字段的唯一标记 */
const CONTINUITY_MARKER = '掌心旧疤未愈，握剑会痛';
const HOLDING_MARKER = '半块青铜虎符';

/**
 * 通过 vault API 写文件（直接写盘要等索引，工作台可能看不到）。
 *
 * @param page - 页面
 * @param relPath - vault 相对路径
 * @param content - 内容
 */
async function writeVaultFile(page: Page, relPath: string, content: string): Promise<void> {
    await page.evaluate(async ({ target, text }) => {
        const app = (window as unknown as {
            app?: {
                vault?: {
                    create?: (path: string, content: string) => Promise<unknown>;
                    modify?: (file: unknown, content: string) => Promise<unknown>;
                    createFolder?: (path: string) => Promise<unknown>;
                    getAbstractFileByPath?: (path: string) => unknown;
                };
            };
        }).app;
        const parts = target.split('/');
        parts.pop();
        let current = '';
        for (const part of parts) {
            current = current ? `${current}/${part}` : part;
            if (!app?.vault?.getAbstractFileByPath?.(current)) {
                await app?.vault?.createFolder?.(current);
            }
        }
        const existing = app?.vault?.getAbstractFileByPath?.(target);
        if (existing) {
            await app?.vault?.modify?.(existing, text);
        } else {
            await app?.vault?.create?.(target, text);
        }
    }, { target: relPath, text: content });
    await page.waitForTimeout(200);
}

/**
 * 写人物卡（含连续性三字段 + entity_status + 性别）。
 *
 * @param page - 页面
 * @param projectId - 项目
 */
async function seedContinuityCharacter(page: Page, projectId: string): Promise<void> {
    const content = [
        '---',
        '姓名: 林玄',
        '身份: 主角',
        '年龄: 18',
        '性别: 男',
        'entity_status: active',
        '核心动机: 查明身世并守住外门',
        '当前状态: 外门弟子',
        '当前情绪: 压抑',
        '伤势: ' + CONTINUITY_MARKER,
        '已知信息: 三年前灭门案的唯一幸存者，知道凶手戴着青铜面具',
        '持有物品: ' + HOLDING_MARKER,
        '性格标签: 隐忍,果决',
        '---',
        '',
        '# 林玄',
        '',
        '## 确定性设定',
        '- 外貌：清瘦，掌心有一道旧疤。',
        '',
    ].join(String.fromCharCode(10));
    await writeVaultFile(page, `${projectId}/01-世界架构/人物/林玄.md`, content);
}

/**
 * 写事实库（结构与 serializeFactStore 同构）。
 *
 * @param page - 页面
 * @param projectId - 项目
 */
async function seedFactStore(page: Page, projectId: string): Promise<void> {
    const store = {
        version: 1,
        updatedAt: new Date().toISOString(),
        facts: [
            {
                type: 'possession',
                subject: '林玄',
                predicate: '持有',
                value: FACT_MARKER,
                validFrom: 1,
                validTo: null,
                confidence: 0.95,
                quote: `怀里的${FACT_MARKER}是他仅有的遗物`,
                chapter: 1,
                event: '灭门遗物',
                slot: '持有',
                isCurrentState: true,
            },
        ],
    };
    await writeVaultFile(
        page,
        `${projectId}/04-项目总控/一致性审核/事实库.json`,
        JSON.stringify(store, null, 2),
    );
}

test.describe('阶段2 · 真实项目注入链路验证（mock AI）', () => {
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

    test('事实库与人物卡连续性字段真的进入写作 prompt', async () => {
        const session = await launchObsidian(env.vault);
        try {
            const { page } = session;
            await waitForPluginLoaded(page);
            await page.waitForTimeout(2_500);

            const projectName = `阶段2验证${Date.now()}`;
            const projectId = await createLongProjectViaUi(page, projectName);
            await seedContinuityCharacter(page, projectId);
            await seedFactStore(page, projectId);
            const seeded = await seedChapter(page, env.vault, projectId, 1, '开篇', '第一章占位正文，等待生成。');
            await openChapterInFullWriter(page, projectId, seeded.bodyRel, '第1章');

            const completed = await runChapterFromWorkbench(page, 'step');
            expect(completed.length, '至少完成一个 AI 步骤').toBeGreaterThan(0);

            // 抓取实际发出的 prompt
            const prompts = await env.server.prompts();
            expect(prompts.length, 'mock server 应记录到 prompt').toBeGreaterThan(0);

            const all = prompts.map(item => `${item.system}\n${item.user}`).join('\n\n');
            // 证据落盘（供人工复核，不进断言）
            const evidencePath = path.resolve(process.cwd(), 'docs', 'analysis', 'stage2-prompt-evidence.md');
            fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
            fs.writeFileSync(evidencePath, [
                '# 阶段2 · 注入链路 prompt 证据',
                '',
                `- 生成时间：${new Date().toISOString()}`,
                `- 项目：${projectName}`,
                `- prompt 条数：${prompts.length}`,
                '',
                '## 断言结果',
                '',
                `- 事实库标记「${FACT_MARKER}」出现在 prompt：${all.includes(FACT_MARKER)}`,
                `- 人物卡伤势「${CONTINUITY_MARKER}」出现在 prompt：${all.includes(CONTINUITY_MARKER)}`,
                `- 人物卡持有物品「${HOLDING_MARKER}」出现在 prompt：${all.includes(HOLDING_MARKER)}`,
                '',
                '## 各 prompt 摘要（kind / 字数 / 命中标记）',
                '',
                ...prompts.map((item, index) => `- #${index + 1} ${item.kind} · system ${item.system.length} 字 / user ${item.user.length} 字 · 命中：${
                    [FACT_MARKER, CONTINUITY_MARKER, HOLDING_MARKER].filter(marker => `${item.system}${item.user}`.includes(marker)).join('、') || '无'
                }`),
                '',
            ].join('\n'), 'utf8');

            // 核心断言：结构化数据必须进 prompt
            expect(all, `事实库标记「${FACT_MARKER}」应进入写作 prompt`).toContain(FACT_MARKER);
            expect(all, `人物卡伤势「${CONTINUITY_MARKER}」应进入写作 prompt`).toContain(CONTINUITY_MARKER);
            expect(all, `人物卡持有物品「${HOLDING_MARKER}」应进入写作 prompt`).toContain(HOLDING_MARKER);
        } finally {
            await session.close().catch(() => undefined);
        }
    });
});
