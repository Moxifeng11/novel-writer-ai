import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
    describeSkipReason,
    isObsidianE2EEnabled,
    launchObsidian,
    waitForModalPage,
    waitForPluginLoaded,
    type ObsidianSession,
} from './utils/obsidian-app';
import {
    createMockEnvironment,
    disposeMockEnvironment,
    type MockEnvironment,
} from './utils/mock-ai';

/**
 * 短篇 / 剧本最小闭环（mock AI）：
 * 种入项目 → 创作流程 → 单元 AI 生成 → 六维/可拍质检 → 完成 → 结算 → 导出平台包。
 */
test.describe('Novel Writer AI · 短篇/剧本闭环（mock AI）', () => {
    test.describe.configure({ mode: 'serial' });
    test.skip(!isObsidianE2EEnabled(), describeSkipReason());

    let env: MockEnvironment;
    let session: ObsidianSession;

    test.beforeAll(async () => {
        env = await createMockEnvironment();
        session = await launchObsidian(env.vault);
        session.page.on('pageerror', error => console.error('[mode-journey pageerror]', error.message));
        await waitForPluginLoaded(session.page);
        await session.page.waitForTimeout(1_500);
    });

    test.afterAll(async () => {
        if (session) await session.close().catch(() => undefined);
        await disposeMockEnvironment(env);
        if (env && process.env.KEEP_E2E_VAULT !== '1') {
            fs.rmSync(env.vault.path, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
        }
    });

    async function seedModeProject(mode: 'short' | 'script', name: string): Promise<{
        project: string;
        unitPath: string;
        reportDir: string;
    }> {
        return await session.page.evaluate(async ({ mode, name }) => {
            const host = window as unknown as {
                app?: {
                    vault?: {
                        getAbstractFileByPath(p: string): unknown;
                        createFolder(p: string): Promise<unknown>;
                        create(p: string, content: string): Promise<unknown>;
                        modify(file: unknown, content: string): Promise<void>;
                    };
                };
            };
            const vault = host.app?.vault;
            if (!vault) throw new Error('vault 不可用');
            const project = `${mode === 'short' ? '短篇小说' : '剧本'}/${name}`;
            const write = async (rel: string, content: string): Promise<void> => {
                if (vault.getAbstractFileByPath(rel)) await vault.modify(vault.getAbstractFileByPath(rel), content);
                else await vault.create(rel, content);
            };
            const ensure = async (dir: string): Promise<void> => {
                const parts = dir.split('/');
                for (let i = 1; i <= parts.length; i++) {
                    const current = parts.slice(0, i).join('/');
                    if (!vault.getAbstractFileByPath(current)) await vault.createFolder(current).catch(() => undefined);
                }
            };
            const unitDir = mode === 'short' ? '短篇创作/03-正文' : '剧本创作/03-剧本';
            const reviewDir = mode === 'short' ? '短篇创作/04-质检' : '剧本创作/05-质检';
            for (const dir of ['00-前期调研', unitDir, reviewDir, mode === 'short' ? '短篇创作/01-故事核' : '剧本创作/01-人物与场景', mode === 'short' ? '短篇创作/02-分节大纲' : '剧本创作/02-分集大纲', mode === 'script' ? '剧本创作/04-分镜' : '']) {
                if (dir) await ensure(`${project}/${dir}`);
            }

            const meta = `# ${name}\n\n## 创作模式\n${mode}\n\n## 短篇分类\n都市\n\n## 目标字数\n3000\n\n## ${mode === 'short' ? '目标节数' : '目标集数'}\n1\n`;
            await write(`${project}/.project`, meta);

            const research = mode === 'short'
                ? {
                    mode: 'short', name, primaryCategory: '都市', targetWords: 3000, targetSections: 1,
                    premise: '替人收拾残局的女人，最后一次交易遇到三年前不告而别的人。',
                    coreConflict: '她想拿钱走人，他想让她留下。',
                    emotionalPromise: '克制但后劲很足的旧情复燃。', reversals: '合同最后一页是旧车票。',
                    endingPayoff: '她烧掉车票却改了回程日期。', plotTags: '反转、旧情', characterCore: '嘴硬心软',
                    emotionCurve: '', background: '', audience: '', references: '', notes: '',
                }
                : {
                    mode: 'script', name, genre: '都市情感', targetWords: 900, targetEpisodes: 1, episodeSeconds: 90,
                    logline: '一纸合同把两个旧情人重新绑在一起。', hook3s: '她把合同拍在桌上，说签字或者我走。',
                    coreConflict: '她想拿钱走人，他想让她留下。', payoff: '旧车票揭开当年离开的真相。', paywallEpisode: 1,
                    characters: '林晚：中间人；顾沉：委托人', scenes: '咖啡馆、天台', audience: '女频',
                    references: '', notes: '',
                };
            await write(`${project}/00-前期调研/调研数据.json`, JSON.stringify(research, null, 2));

            if (mode === 'short') {
                await write(`${project}/短篇创作/01-故事核/故事核.md`, '## 一句话前提\n替人收拾残局的女人最后一次交易遇到旧识。\n');
                await write(`${project}/短篇创作/02-分节大纲/分节大纲.md`, '第1节：雨夜咖啡馆，林晚送合同，发现委托人是旧识；结尾对方拒签。\n第2节：林晚查旧车票，确认当年离开的真相。\n第3节：合同最后一页被翻开，她必须在走与留之间选择。\n');
            } else {
                await write(`${project}/剧本创作/01-人物与场景/场景圣经.md`, '## 主要人物\n- 林晚：中间人\n- 顾沉：委托人\n');
                await write(`${project}/剧本创作/02-分集大纲/分集大纲.md`, '第1集：雨夜咖啡馆，合同与旧车票；结尾林晚改签回程。\n第2集：顾沉追到天台，两人第一次正面冲突。\n第3集：旧车票揭开当年离开的真相。\n');
                await write(`${project}/剧本创作/04-分镜/分镜表.md`, '## 第1集\n### 第1场 日 内 咖啡馆\n- 画面：雨窗、合同\n- 台词：林晚“签字。”\n');
            }

            const unitPath = `${project}/${unitDir}/第01${mode === 'short' ? '节' : '集'}.md`;
            await write(unitPath, `---\nstatus: pending\nword_count: 0\n---\n\n# 第1${mode === 'short' ? '节' : '集'}\n`);
            return { project, unitPath, reportDir: `${project}/${reviewDir}` };
        }, { mode, name });
    }

    async function openFlow(project: string): Promise<void> {
        await session.page.evaluate(async (projectId) => {
            const host = window as unknown as {
                app?: { plugins?: { plugins?: Record<string, { openCreationFlow(project?: string): Promise<void> }> } };
            };
            await host.app?.plugins?.plugins?.['novel-writer-ai']?.openCreationFlow(projectId);
        }, project);
        await expect(session.page.locator('.nw-flow-panel')).toBeVisible({ timeout: 20_000 });
    }

    async function ensureOutlineGenerated(): Promise<void> {
        const { page } = session;
        const title = (await page.locator('.nw-flow-next-title').textContent())?.trim() || '';
        if (title !== '分节大纲' && title !== '分集大纲') return;
        await page.locator('.nw-flow-next-actions button').first().click();
        const modalPage = await waitForModalPage(page, 15_000);
        const modal = modalPage.locator('.modal-container').last();
        await expect(modal).toBeVisible();
        const aiButton = modal.getByRole('button', { name: /AI 生成/ });
        await aiButton.click();
        // 生成中按钮禁用：等它恢复再校验输出，避免在生成完成前点保存写回种子文本
        await expect(aiButton).toBeEnabled({ timeout: 30_000 });
        await expect.poll(async () => modal.locator('.nw-mode-doc-editor').inputValue(), { timeout: 30_000 })
            .toContain('第2');
        await modal.getByRole('button', { name: '保存', exact: true }).click();
        await expect(modal).toBeHidden({ timeout: 10_000 });
        await expect(page.locator('.nw-flow-next-title')).not.toHaveText(title, { timeout: 10_000 });
    }

    async function generateQualitySettle(qualityLabel: RegExp, unitPath: string, reportDir: string): Promise<void> {
        const { page } = session;
        await page.locator('.nw-flow-next-actions button').first().click();
        await expect(page.locator('.nw-unit-panel')).toBeVisible({ timeout: 20_000 });
        await page.getByRole('button', { name: /AI 生成本/ }).click();
        await expect.poll(async () => page.locator('.nw-unit-editor').inputValue(), { timeout: 30_000 })
            .toContain('林晚');

        await page.getByRole('button', { name: qualityLabel }).click();
        await expect(page.locator('.nw-unit-quality-score')).toBeVisible({ timeout: 30_000 });
        await expect(page.locator('.nw-unit-quality-saved')).toContainText('质检');

        // 结算本身会把 status 置为 settled；不再点「完成本」（那会把状态写回 written 并跳下一单元）
        await page.getByRole('button', { name: /单元结算/ }).click();
        await expect(page.locator('.nw-unit-ai-status')).toContainText('已结算', { timeout: 20_000 });

        const unitAbs = path.join(session.vault.path, unitPath);
        await expect.poll(() => fs.existsSync(unitAbs) ? fs.readFileSync(unitAbs, 'utf8') : '', { timeout: 15_000 })
            .toMatch(/status:\s*['"]?settled['"]?/);
        const reportAbs = path.join(session.vault.path, reportDir);
        const reports = fs.existsSync(reportAbs) ? fs.readdirSync(reportAbs) : [];
        expect(reports.some(name => name.endsWith('_质检.md'))).toBe(true);
        expect(reports.some(name => name.endsWith('_结算.md'))).toBe(true);
    }

    async function exportPlatformPackage(mode: 'short' | 'script', project: string): Promise<string> {
        const { page, vault } = session;
        await openFlow(project);
        await expect(page.locator('.nw-flow-next-title')).toHaveText('导出成稿', { timeout: 20_000 });
        await page.locator('.nw-flow-next-actions button').first().click();
        const modalPage = await waitForModalPage(page, 15_000);
        const modal = modalPage.locator('.modal-container').last();
        await expect(modal).toBeVisible();

        const selects = modal.locator('select');
        const count = await selects.count();
        let txtSelect = null;
        for (let index = 0; index < count; index++) {
            const labels = await selects.nth(index).locator('option').allTextContents();
            if (labels.some(label => label.includes('TXT'))) { txtSelect = selects.nth(index); break; }
        }
        expect(txtSelect).not.toBeNull();
        await txtSelect!.selectOption({ label: (await txtSelect!.locator('option').allTextContents()).find(label => label.includes('TXT'))! });

        await page.evaluate(() => {
            const host = window as unknown as { app?: { isMobile?: boolean } };
            if (host.app) host.app.isMobile = true;
        });
        await modal.getByRole('button', { name: '导出', exact: true }).click();

        const exportDir = path.join(vault.path, '导出文件');
        await expect.poll(() => fs.existsSync(exportDir) ? fs.readdirSync(exportDir) : [], { timeout: 30_000 })
            .toEqual(expect.arrayContaining([expect.stringMatching(mode === 'short' ? /^番茄短篇_/ : /^红果短剧_/)]));
        const file = fs.readdirSync(exportDir).find(name => mode === 'short' ? name.startsWith('番茄短篇_') : name.startsWith('红果短剧_'));
        expect(file).toBeTruthy();
        const fileAbs = path.join(exportDir, file!);
        // 文件可能刚创建、内容还在写入：轮询到平台头出现再断言
        await expect.poll(() => fs.existsSync(fileAbs) ? fs.readFileSync(fileAbs, 'utf8') : '', { timeout: 30_000 })
            .toContain('【平台投稿信息】');
        const content = fs.readFileSync(fileAbs, 'utf8');
        expect(content).toContain(mode === 'short' ? '平台：番茄小说短篇' : '平台：红果短剧');
        return content;
    }

    test('短篇：AI 生成 → 六维质检 → 完成 → 结算 → 番茄平台包', async () => {
        const { project, unitPath, reportDir } = await seedModeProject('short', `E2E短篇${Date.now()}`);
        await openFlow(project);
        await expect(session.page.locator('.nw-flow-stage')).toHaveCount(4);
        await ensureOutlineGenerated();
        await expect(session.page.locator('.nw-flow-next-title')).toHaveText('分节写作');
        await generateQualitySettle(/六维质检/, unitPath, reportDir);
        const content = await exportPlatformPackage('short', project);
        expect(content).toContain('简介：');
        expect(content).toContain('字数：');
    });

    test('剧本：AI 生成 → 可拍质检 → 完成 → 结算 → 红果平台包', async () => {
        const { project, unitPath, reportDir } = await seedModeProject('script', `E2E剧本${Date.now()}`);
        await openFlow(project);
        await expect(session.page.locator('.nw-flow-stage')).toHaveCount(5);
        await ensureOutlineGenerated();
        await generateQualitySettle(/可拍质检/, unitPath, reportDir);
        const content = await exportPlatformPackage('script', project);
        expect(content).toContain('故事简介：');
        expect(content).toContain('单元：1 集');
    });
});
