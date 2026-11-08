import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
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
    PLUGIN_ID,
    createLongProjectViaUi,
    exportTxtViaUi,
    openChapterInFullWriter,
    readTextIfExists,
    runChapterFromWorkbench,
    seedChapter,
    seedCharacterViaVault,
} from './utils/e2e-workflow';

/**
 * 用户生产环境模拟：真实 Obsidian + 临时 vault + 本地 mock AI。
 *
 * 一次跑完：创建长篇项目（UI）→ 打开工作台 → 逐步规划/正文/质控/分析/结算
 * → 导出 TXT → 禁用/启用插件后数据仍在。
 * 未配置 OBSIDIAN_PATH 时整组明确跳过。
 */
test.describe('Novel Writer AI · 完整用户旅程（mock AI）', () => {
    test.describe.configure({ mode: 'serial' });
    test.skip(!isObsidianE2EEnabled(), describeSkipReason());

    let env: MockEnvironment;
    let session: ObsidianSession;

    test.beforeAll(async () => {
        env = await createMockEnvironment();
        session = await launchObsidian(env.vault);
        session.page.on('pageerror', (error) => {
            console.error('[full-journey pageerror]', error.message);
        });
        session.page.on('console', (message) => {
            if (message.type() === 'error') console.error('[full-journey console]', message.text());
        });
        await waitForPluginLoaded(session.page);
        await session.page.waitForTimeout(2_500);
    });

    test.afterAll(async () => {
        if (session) await session.close().catch(() => undefined);
        await disposeMockEnvironment(env);
        if (env && process.env.KEEP_E2E_VAULT !== '1') {
            fs.rmSync(env.vault.path, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
        }
    });

    test('创建长篇项目 → 一键跑到结算 → 导出 TXT → 禁用/启用后数据仍在', async () => {
        const { page, vault } = session;
        const projectName = `E2E全流程${Date.now()}`;

        // 1) UI 创建长篇项目（覆盖创建弹窗入口）
        const projectId = await createLongProjectViaUi(page, projectName);
        const projectRoot = path.join(vault.path, projectId);
        expect(fs.existsSync(path.join(projectRoot, '03-大纲与章节'))).toBe(true);
        expect(fs.existsSync(path.join(projectRoot, '.project'))).toBe(true);

        // 2) 准备主角卡（上下文必做输入「人物状态」）与章节骨架，然后打开工作台
        await seedCharacterViaVault(page, projectId);
        const seeded = await seedChapter(page, vault, projectId, 1, '测试章', '第一章初始占位，等待 AI 生成。');
        await openChapterInFullWriter(page, projectId, seeded.bodyRel, '第1章');

        // 3) 逐步执行：信息规划 → 情节蒸馏 → 大纲 → 情绪 → Scene → 正文 → 质控 → 分析 → 结算
        let completedSteps: string[];
        try {
            completedSteps = await runChapterFromWorkbench(page, 'step');
        } catch (e) {
            console.error('[full-journey] mock stats', JSON.stringify(await env.server.stats()));
            throw e;
        }
        expect(completedSteps).toEqual(expect.arrayContaining([
            'infoPlan',
            'plotDistill',
            'outline',
            'emotionPlan',
            'sceneExpand',
            'bodyGeneration',
            'qualityControl',
            'analysisReport',
            'settlement',
        ]));

        const expectedSteps = [
            '信息规划',
            '情节蒸馏',
            '大纲摘要',
            '情绪规划',
            'Scene展开',
            '质量控制',
            '分析报告',
        ];
        for (const stepName of expectedSteps) {
            const stepFile = path.join(seeded.stepAbs, `第1章_${stepName}.md`);
            expect(fs.existsSync(stepFile), `缺少步骤文件：${stepName}`).toBe(true);
            expect(readTextIfExists(stepFile).trim().length, `步骤文件为空：${stepName}`).toBeGreaterThan(0);
        }

        // 4) 正文断言：有标题、达到 3000 字、frontmatter 已结算
        const body = readTextIfExists(seeded.bodyAbs);
        expect(body).toMatch(/^#\s*第1章\s+\S+/m);
        const bodyWithoutFrontmatter = body.replace(/^---[\s\S]*?---\s*/, '');
        expect(bodyWithoutFrontmatter.length).toBeGreaterThanOrEqual(3_000);
        expect(bodyWithoutFrontmatter).toMatch(/[“”「」]/);
        expect(body).toMatch(/^status:\s*['"]?settled['"]?\s*$/m);

        // 5) 导出 TXT（UI 入口）并断言非空
        const exported = await exportTxtViaUi(page, vault.path);
        expect(exported.toLowerCase().endsWith('.txt')).toBe(true);
        expect(fs.statSync(exported).size).toBeGreaterThan(0);
        // v4.80.0 审计：不只断言“有文件”，还要证明正文进了导出（取正文前 40 字忽略空白）
        const exportedText = fs.readFileSync(exported, 'utf8');
        const expectedSnippet = bodyWithoutFrontmatter.replace(/^#.*$/m, '').replace(/s+/g, ' ').trim().slice(0, 40);
        expect(expectedSnippet.length).toBeGreaterThan(20);
        expect(exportedText.replace(/s+/g, ' ')).toContain(expectedSnippet);

        // 6) 禁用/启用插件后，项目文件与结算状态仍在
        await page.evaluate(async (pluginId) => {
            const app = (window as unknown as {
                app?: { plugins?: { disablePlugin?: (id: string) => Promise<void> } };
            }).app;
            await app?.plugins?.disablePlugin?.(pluginId);
        }, PLUGIN_ID);
        await page.waitForTimeout(700);

        await page.evaluate(async (pluginId) => {
            const app = (window as unknown as {
                app?: { plugins?: { enablePlugin?: (id: string) => Promise<void> } };
            }).app;
            await app?.plugins?.enablePlugin?.(pluginId);
        }, PLUGIN_ID);
        await waitForPluginLoaded(page);
        await page.waitForTimeout(1_000);

        expect(fs.existsSync(seeded.bodyAbs)).toBe(true);
        expect(fs.existsSync(path.join(projectRoot, '.project'))).toBe(true);
        expect(readTextIfExists(seeded.bodyAbs)).toMatch(/^status:\s*['"]?settled['"]?\s*$/m);

        const commandRegistered = await page.evaluate(() => {
            const app = (window as unknown as {
                app?: { commands?: { commands?: Record<string, unknown> } };
            }).app;
            return Boolean(app?.commands?.commands?.['novel-writer-ai:novel-writer-create-project']);
        });
        expect(commandRegistered).toBe(true);
    });
});
