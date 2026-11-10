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

        // 3.5) 步骤结算产物：结算表 / 时间线列宽 / 一致性报告（B 轮收口断言）
        const settlementTablePath = path.join(seeded.stepAbs, '第1章_结算表.md');
        expect(fs.existsSync(settlementTablePath), '步骤结算应落 第1章_结算表.md').toBe(true);
        const settlementTable = readTextIfExists(settlementTablePath);
        expect(settlementTable).toContain('# 第1章 结算表');
        // 表体不能退化为只有标题：结算模式与至少一条统计行必须在
        expect(settlementTable).toContain('settlement_mode: full');
        expect(settlementTable).toMatch(/^- 新建时间线事件：\d+ 个$/m);

        // mock 结算固定产 NEW_TIMELINE，看板必然存在；缺失即回归，不再条件跳过
        const timelineBoardPath = path.join(projectRoot, '02-时间线与伏笔', '时间线看板.md');
        expect(fs.existsSync(timelineBoardPath), '结算应落 时间线看板.md').toBe(true);
        const boardLines = readTextIfExists(timelineBoardPath).split('\n');
        const isSeparator = (line: string): boolean => /^\|[\s:|-]+\|$/.test(line.trim());
        const headerIdx = boardLines.findIndex((line) => line.trim().startsWith('|') && !isSeparator(line));
        expect(headerIdx, '时间线看板缺少表头').toBeGreaterThanOrEqual(0);
        const headerCols = boardLines[headerIdx].trim().split('|').length - 2;
        const dataRows = boardLines
            .slice(headerIdx + 2)
            .filter((line) => line.trim().startsWith('|') && !isSeparator(line));
        expect(dataRows.length, '时间线看板应有至少 1 行数据').toBeGreaterThan(0);
        expect(dataRows.join('\n'), '结算事件应写入时间线看板').toContain('外门考核');
        const badRow = dataRows.find((line) => (line.trim().split('|').length - 2) !== headerCols);
        expect(badRow, `时间线看板存在列数不齐的行：${badRow ?? ''}`).toBeUndefined();

        // seedCharacterViaVault 是无条件播种的，人物卡必然存在；缺失即回归
        const characterDir = path.join(projectRoot, '01-世界架构', '人物');
        expect(fs.existsSync(characterDir), '人物目录应存在').toBe(true);
        const hasCharacterCard = fs.readdirSync(characterDir)
            .some((file) => file.endsWith('.md') && !file.includes('模板'));
        expect(hasCharacterCard, '人物卡应存在').toBe(true);
        const consistencyPath = path.join(seeded.stepAbs, '第1章_一致性检查.md');
        expect(fs.existsSync(consistencyPath), '存在人物卡时应生成 第1章_一致性检查.md').toBe(true);

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
        const expectedSnippet = bodyWithoutFrontmatter.replace(/^#.*$/m, '').replace(/\s+/g, ' ').trim().slice(0, 40);
        expect(expectedSnippet.length).toBeGreaterThan(20);
        expect(exportedText.replace(/\s+/g, ' ')).toContain(expectedSnippet);

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
