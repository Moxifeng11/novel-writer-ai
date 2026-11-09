import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
    createTestVault,
    describeSkipReason,
    executeCommand,
    isObsidianE2EEnabled,
    launchObsidian,
    toObsidianCommandId,
    waitForModalPage,
    waitForPluginLoaded,
    type ObsidianSession,
} from './utils/obsidian-app';

/**
 * Obsidian 真实 Electron 链路 E2E。
 *
 * 覆盖 PRD §3 的 P0 旅程：创建项目 → 打开完整写作工作台。
 * 运行前需设置 OBSIDIAN_PATH；未配置时整组用例明确跳过，而不是以占位断言“假通过”。
 */

const CREATE_PROJECT_COMMAND = toObsidianCommandId('novel-writer-create-project');
const AGENT_GUIDE_COMMAND = toObsidianCommandId('novel-writer-agent-guide');
const SETTINGS_COMMAND = toObsidianCommandId('novel-writer-open-settings');
const TOGGLE_PET_COMMAND = toObsidianCommandId('novel-writer-toggle-pet');
const FULL_WRITER_VIEW_TYPE = 'novel-writer-full-writer';

test.describe('Novel Writer AI · 真实 Electron 链路', () => {
    test.describe.configure({ mode: 'serial' });
    test.skip(!isObsidianE2EEnabled(), describeSkipReason());

    let session: ObsidianSession;

    test.beforeAll(async () => {
        const vault = createTestVault();
        session = await launchObsidian(vault);
        // E2E 失败时把渲染进程异常带回终端，避免只剩一个“modal 不可见”。
        session.page.on('pageerror', (error) => {
            console.error('[E2E pageerror]', error.message);
        });
        session.page.on('console', (message) => {
            if (message.type() === 'error') console.error('[E2E console]', message.text());
        });
        await waitForPluginLoaded(session.page);
        // 插件 onload 会异步自举模板目录；等布局与命令回调稳定后再执行用户旅程。
        await session.page.waitForTimeout(3_000);
    });

    test.afterAll(async () => {
        if (!session) return;
        await session.close().catch(() => undefined);
        if (process.env.KEEP_E2E_VAULT !== '1') {
            fs.rmSync(session.vault.path, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
        }
    });

    test('插件应被 Obsidian 加载并注册命令', async () => {
        const { page } = session;

        const pluginLoaded = await page.evaluate(() => {
            const host = window as unknown as {
                app?: { plugins?: { plugins?: Record<string, unknown> } };
            };
            return Boolean(host.app?.plugins?.plugins?.['novel-writer-ai']);
        });
        expect(pluginLoaded).toBe(true);

        const commandRegistered = await page.evaluate((id) => {
            const host = window as unknown as {
                app?: { commands?: { commands?: Record<string, unknown> } };
            };
            return Boolean(host.app?.commands?.commands?.[id]);
        }, CREATE_PROJECT_COMMAND);
        expect(commandRegistered).toBe(true);
    });

    test('创建项目后应打开完整写作工作台并落盘目录', async () => {
        const { page, vault } = session;
        const projectName = `E2E项目${Date.now()}`;

        expect(await executeCommand(page, CREATE_PROJECT_COMMAND)).toBe(true);

        // Obsidian 1.14 会把 Modal 挂到单独的 about:blank 窗口，不能只在主工作区页面里找。
        const modalPage = await waitForModalPage(page, 15_000);
        const modal = modalPage.locator('.modal-container').last();
        await expect(modal).toBeVisible();
        await expect(modal.locator('.nw-story-structure-card')).toHaveCount(5);
        await modal.getByRole('button', { name: /智能随机/ }).click();
        await expect(modal.locator('.nw-story-warning-ok')).toBeVisible();
        await modal.locator('input[placeholder*="项目名称"]').fill(projectName);
        await modal.locator('input[placeholder*="题材"]').fill('玄幻');
        await modal.getByRole('button', { name: '创建项目', exact: true }).click();

        const view = page.locator(`.workspace-leaf-content[data-type="${FULL_WRITER_VIEW_TYPE}"]`);
        await expect(view).toBeVisible({ timeout: 90_000 });

        const projectCard = page.locator(`.novel-writer-fw-project-card[data-project="长篇小说/${projectName}"]`);
        await expect(projectCard).toBeVisible({ timeout: 30_000 });

        const projectRoot = path.join(vault.path, '长篇小说', projectName);
        expect(fs.existsSync(projectRoot)).toBe(true);
        expect(fs.existsSync(path.join(projectRoot, '03-大纲与章节'))).toBe(true);
        expect(fs.existsSync(path.join(vault.path, '元文件', '00-系统模板'))).toBe(true);

        const projectMeta = fs.readFileSync(path.join(projectRoot, '.project'), 'utf8');
        expect(projectMeta).toContain('## 故事结构');
        expect(projectMeta).toContain('## 故事创作设置');
        expect(fs.existsSync(path.join(projectRoot, '00-系统模板', '故事结构指南.md'))).toBe(true);

        // 向导应把故事结构纳入步骤，并能从项目卡片进入。
        await page.waitForTimeout(1_000);
        await projectCard.getByRole('button', { name: /向导/ }).click();
        await expect(page.locator('.nw-wizard-container')).toBeVisible({ timeout: 15_000 });
        const wizardSidebar = page.locator('.nw-wizard-sidebar');
        await expect(wizardSidebar).toBeVisible({ timeout: 15_000 });
        await expect(wizardSidebar.locator('.nw-wizard-step-item', { hasText: '故事结构' })).toBeVisible();

        // 无需 AI：写入一个最小正文，进入章节步骤页验证本轮交互改版。
        const projectId = `长篇小说/${projectName}`;
        const bodyPath = `${projectId}/03-大纲与章节/正文/第1卷/第1章_正文.md`;
        await page.evaluate(async ({ projectId: pid, bodyPath: target }) => {
            const host = window as unknown as {
                app?: {
                    vault?: {
                        adapter?: { mkdir?: (path: string) => Promise<void> };
                        create?: (path: string, content: string) => Promise<unknown>;
                        getAbstractFileByPath?: (path: string) => unknown;
                        delete?: (file: unknown) => Promise<void>;
                    };
                    plugins?: { plugins?: Record<string, { openChapterInFullWriter?: (project: string, path: string) => void }> };
                };
            };
            const vault = host.app?.vault;
            const folder = target.split('/').slice(0, -1).join('/');
            for (const dir of [folder]) {
                await vault?.adapter?.mkdir?.(dir).catch(() => undefined);
            }
            await vault?.create?.(target, '---\nstatus: drafting\n---\n\n# 第1章\n\nE2E 正文占位。\n');
            host.app?.plugins?.plugins?.['novel-writer-ai']?.openChapterInFullWriter?.(pid, target);
        }, { projectId, bodyPath });

        const stepArea = page.locator('.novel-writer-fw-prompt-area');
        await expect(stepArea).toBeVisible({ timeout: 30_000 });
        await expect(page.locator('.nw-step-actionbar')).toBeVisible();
        await expect(page.locator('.nw-exec-timeline')).toBeVisible();
        await expect(page.locator('details.nw-prompt-collapsible')).toHaveCount(2);
        expect(await page.locator('details.nw-prompt-collapsible[open]').count()).toBe(0);

        // 章节页可直接切换叙事结构；写入 .project 后重渲染保持选中。
        const narrativeSelect = page.locator('.nw-narrative-select');
        await expect(narrativeSelect).toBeVisible();
        await narrativeSelect.selectOption('five_act');
        await expect(page.locator('.nw-narrative-select')).toHaveValue('five_act');
        await expect.poll(
            () => fs.readFileSync(path.join(projectRoot, '.project'), 'utf8'),
            { timeout: 10_000 },
        ).toContain('five_act');
    });

    test('Agent 工作台「设置」入口可打开插件设置页', async () => {
        const { page } = session;
        expect(await executeCommand(page, AGENT_GUIDE_COMMAND)).toBe(true);

        const workbench = page.locator('.workspace-leaf-content[data-type="novel-writer-agent-workbench"]');
        await expect(workbench).toBeVisible({ timeout: 15_000 });

        // 回归：这个按钮曾指向不存在的命令 id，点击后毫无反应
        const settingsButton = workbench.getByRole('button', { name: /⚙️ 设置/ });
        await expect(settingsButton).toBeVisible();
        await settingsButton.click();

        await expect.poll(async () => page.evaluate(() => {
            const host = window as unknown as {
                app?: { setting?: { activeTab?: { id?: string } } };
            };
            return host.app?.setting?.activeTab?.id ?? '';
        }), { timeout: 10_000 }).toBe('novel-writer-ai');

        // 设置页可能在独立窗口渲染，只校验插件 tab 已挂载
        const tabMounted = await page.evaluate(() => {
            const host = window as unknown as {
                app?: { setting?: { activeTab?: { containerEl?: HTMLElement } } };
            };
            const el = host.app?.setting?.activeTab?.containerEl;
            return Boolean(el && el.isConnected);
        });
        expect(tabMounted).toBe(true);

        // 关闭设置，避免影响后续用例
        await page.evaluate(() => {
            const host = window as unknown as { app?: { setting?: { close?(): void } } };
            host.app?.setting?.close?.();
        });
    });

    test('Agent 输入框支持 @ 文件引用与「新会话」入口', async () => {
        const { page } = session;
        expect(await executeCommand(page, AGENT_GUIDE_COMMAND)).toBe(true);

        const workbench = page.locator('.workspace-leaf-content[data-type="novel-writer-agent-workbench"]');
        await expect(workbench).toBeVisible({ timeout: 15_000 });

        // v4.20：输入框由单行 input 改为 textarea（Shift+Enter 换行、引用/候选需要多行锚点）
        const composer = workbench.locator('textarea.nw-awb-input');
        await expect(composer).toBeVisible({ timeout: 10_000 });
        expect(await composer.evaluate(el => el.tagName)).toBe('TEXTAREA');

        // 会话持久化入口：清空当前项目的 .sessions/agent 存档
        await expect(workbench.getByRole('button', { name: /新会话/ })).toBeVisible();

        // 输入 @ 弹出库内文件候选（只索引路径，不读正文）
        await composer.click();
        await composer.fill('@');
        await expect(workbench.locator('.nw-awb-mention-item').first()).toBeVisible({ timeout: 10_000 });
        expect(await workbench.locator('.nw-awb-mention-item').count()).toBeGreaterThan(0);

        // 选中候选 → 输入框写入 `@路径 `（含空格时用引号）
        await workbench.locator('.nw-awb-mention-item').first().click();
        await expect.poll(async () => composer.inputValue(), { timeout: 5_000 }).toContain('@');
        const value = await composer.inputValue();
        expect(value.trim().startsWith('@')).toBe(true);

        // 不发送（会真实调用模型），清空并关闭候选
        await composer.fill('');
        await composer.press('Escape');
        await expect(workbench.locator('.nw-awb-mention-pop-hidden')).toHaveCount(1);
    });

    test('模型设置是两栏布局，长 URL 完整可见', async () => {
        const { page } = session;
        expect(await executeCommand(page, SETTINGS_COMMAND)).toBe(true);

        // 等两栏渲染
        await expect.poll(async () => page.evaluate(() => {
            const host = window as unknown as {
                app?: { setting?: { activeTab?: { containerEl?: HTMLElement } } };
            };
            const root = host.app?.setting?.activeTab?.containerEl;
            return root?.querySelectorAll('.nw-api-layout').length ?? 0;
        }), { timeout: 15_000 }).toBeGreaterThan(0);

        const metrics = await page.evaluate(() => {
            const host = window as unknown as {
                app?: { setting?: { activeTab?: { containerEl?: HTMLElement } } };
            };
            const root = host.app?.setting?.activeTab?.containerEl;
            if (!root) return null;
            const sidebar = root.querySelector<HTMLElement>('.nw-api-sidebar');
            const detail = root.querySelector<HTMLElement>('.nw-api-detail');
            const urlInput = root.querySelector<HTMLInputElement>('.nw-api-text-input');
            const select = root.querySelector<HTMLSelectElement>('.nw-api-select');
            return {
                sidebarW: sidebar ? Math.round(sidebar.getBoundingClientRect().width) : 0,
                detailW: detail ? Math.round(detail.getBoundingClientRect().width) : 0,
                urlInputW: urlInput ? Math.round(urlInput.getBoundingClientRect().width) : 0,
                selectW: select ? Math.round(select.getBoundingClientRect().width) : 0,
                formatOptions: select ? Array.from(select.options).map(o => o.value) : [],
                sidebarRows: root.querySelectorAll('.nw-api-sidebar-row').length,
                switches: root.querySelectorAll('.nw-api-switch').length,
                hasFetchButton: Array.from(root.querySelectorAll('button'))
                    .some(button => (button.textContent || '').includes('从 URL 获取')),
            };
        });

        console.log('API_SETTINGS_METRICS ' + JSON.stringify(metrics));
        expect(metrics).not.toBeNull();
        if (!metrics) return;

        // 左栏定宽、右栏占满剩余
        expect(metrics.sidebarW).toBeGreaterThan(200);
        expect(metrics.sidebarW).toBeLessThan(300);
        expect(metrics.detailW).toBeGreaterThan(metrics.sidebarW + 100);

        // 核心回归：输入框必须接近详情区宽度，长 URL 不能被截在窄框里
        expect(metrics.urlInputW).toBeGreaterThan(metrics.detailW * 0.85);
        expect(metrics.selectW).toBeGreaterThan(metrics.detailW * 0.85);

        expect(metrics.formatOptions).toEqual(
            expect.arrayContaining(['openai-chat', 'anthropic-messages', 'openai-responses']),
        );
        expect(metrics.sidebarRows).toBeGreaterThan(0);
        expect(metrics.switches).toBeGreaterThan(0);
        expect(metrics.hasFetchButton).toBe(true);

        // 设置页在独立窗口渲染：按「哪个页面里有 .nw-api-layout」挑页面截图
        let settingsPage = page;
        for (const candidate of page.context().pages()) {
            const found = await candidate
                .evaluate(() => document.querySelectorAll('.nw-api-layout').length)
                .catch(() => 0);
            if (found > 0) { settingsPage = candidate; break; }
        }
        const outDir = path.resolve(__dirname, '../../test-results');
        fs.mkdirSync(outDir, { recursive: true });
        await settingsPage.screenshot({ path: path.join(outDir, 'api-settings-layout.png') });

        await page.evaluate(() => {
            const host = window as unknown as { app?: { setting?: { close?(): void } } };
            host.app?.setting?.close?.();
        });
    });

    test('规则版本「重新检查」不重复渲染模块', async () => {
        const { page } = session;
        expect(await executeCommand(page, SETTINGS_COMMAND)).toBe(true);

        const switchTab = async (label: string): Promise<boolean> => {
            const ok = await page.evaluate((name) => {
                const host = window as unknown as {
                    app?: { setting?: { activeTab?: { containerEl?: HTMLElement } } };
                };
                const root = host.app?.setting?.activeTab?.containerEl;
                if (!root) return false;
                const tab = Array.from(root.querySelectorAll('.nw-settings-tab'))
                    .find(el => ((el as HTMLElement).textContent || '').includes(name));
                if (!tab) return false;
                (tab as HTMLElement).click();
                return true;
            }, label);
            return ok;
        };

        await expect.poll(() => switchTab('写作规则'), { timeout: 15_000 }).toBe(true);

        const countSections = () => page.evaluate(() => {
            const host = window as unknown as {
                app?: { setting?: { activeTab?: { containerEl?: HTMLElement } } };
            };
            const root = host.app?.setting?.activeTab?.containerEl;
            if (!root) return -1;
            // v4.27：设置页改为「每个页签一个 .nw-settings-panel 容器 + 面板缓存」，
            // section 不再是 tab-content 的直接子节点；改为数面板内的 section。
            return root.querySelectorAll('.nw-settings-tab-content section').length;
        });

        await expect.poll(async () => countSections(), { timeout: 15_000 }).toBe(1);
        const before = await countSections();
        expect(before).toBe(1);

        for (let i = 0; i < 3; i++) {
            // 点击后 mountRulesSection 会先置为「检查中…」再异步重绘；固定等待 400ms 在
            // 磁盘慢时会点空（规则版本现在要扫 vault/项目两个目录 + 读文件），改为轮询按钮回到可点状态。
            await expect.poll(async () => page.evaluate(() => {
                const host = window as unknown as {
                    app?: { setting?: { activeTab?: { containerEl?: HTMLElement } } };
                };
                const root = host.app?.setting?.activeTab?.containerEl;
                const btn = Array.from(root?.querySelectorAll('button') ?? [])
                    .find(el => ((el as HTMLElement).textContent || '').includes('重新检查'));
                if (!btn) return false;
                (btn as HTMLElement).click();
                return true;
            }), { timeout: 15_000 }).toBe(true);
            // 每次重绘完成后都必须仍然只有一块模块
            await expect.poll(async () => countSections(), { timeout: 15_000 }).toBe(1);
        }

        const after = await countSections();
        console.log('RULES_SECTION_COUNT ' + JSON.stringify({ before, after }));
        expect(after).toBe(1);
    });

    test('写作配置按五组组织，写作规则页集中版本管理', async () => {
        const { page } = session;
        expect(await executeCommand(page, SETTINGS_COMMAND)).toBe(true);

        const switchTab = async (label: string): Promise<boolean> => page.evaluate((name) => {
            const host = window as unknown as {
                app?: { setting?: { activeTab?: { containerEl?: HTMLElement } } };
            };
            const root = host.app?.setting?.activeTab?.containerEl;
            if (!root) return false;
            const tab = Array.from(root.querySelectorAll('.nw-settings-tab'))
                .find(el => ((el as HTMLElement).textContent || '').includes(name));
            if (!tab) return false;
            (tab as HTMLElement).click();
            return true;
        }, label);

        await expect.poll(() => switchTab('写作配置'), { timeout: 15_000 }).toBe(true);
        const activeText = () => page.evaluate(() => {
            const host = window as unknown as {
                app?: { setting?: { activeTab?: { containerEl?: HTMLElement } } };
            };
            const root = host.app?.setting?.activeTab?.containerEl;
            return root?.querySelector('.nw-settings-tab-content')?.textContent || '';
        });
        await expect.poll(async () => page.evaluate(() => {
            const host = window as unknown as {
                app?: { setting?: { activeTab?: { containerEl?: HTMLElement } } };
            };
            const root = host.app?.setting?.activeTab?.containerEl;
            return Array.from(root?.querySelectorAll('.nw-settings-tab-content h4') ?? [])
                .map(el => (el.textContent || '').trim()).join('|');
        }), { timeout: 15_000 }).toContain('篇幅与字数');

        const groups = await page.evaluate(() => {
            const host = window as unknown as {
                app?: { setting?: { activeTab?: { containerEl?: HTMLElement } } };
            };
            const root = host.app?.setting?.activeTab?.containerEl;
            return Array.from(root?.querySelectorAll('.nw-settings-tab-content h4') ?? [])
                .map(el => (el.textContent || '').trim());
        });
        for (const title of ['篇幅与字数', '正文形态', '上下文与模型', '质量闸门与修订', '阈值与词表']) {
            expect(groups).toContain(title);
        }
        const writingText = await activeText();
        expect(writingText).not.toContain('生效版本');
        expect(writingText).not.toContain('实验分组标签');

        await expect.poll(() => switchTab('写作规则'), { timeout: 15_000 }).toBe(true);
        await expect.poll(activeText, { timeout: 15_000 }).toContain('唯一来源:');
        await expect.poll(activeText, { timeout: 15_000 }).toContain('重新检查');
        const rulesText = await activeText();
        expect(rulesText).toContain('实验分组标签');
        expect(rulesText).toContain('重新检查');

        // 三模式路径总览
        await expect.poll(() => switchTab('创作模式'), { timeout: 15_000 }).toBe(true);
        await expect.poll(activeText, { timeout: 15_000 }).toContain('项目库根目录');
        const modesText = await activeText();
        for (const label of ['长篇小说', '短篇小说', '短剧剧本']) {
            expect(modesText).toContain(label);
        }
    });

    test('外观设置是三层结构且配色方案可保存', async () => {
        const { page } = session;
        expect(await executeCommand(page, SETTINGS_COMMAND)).toBe(true);

        const switched = await page.evaluate(() => {
            const host = window as unknown as {
                app?: { setting?: { activeTab?: { containerEl?: HTMLElement } } };
            };
            const root = host.app?.setting?.activeTab?.containerEl;
            if (!root) return false;
            const tab = Array.from(root.querySelectorAll('.nw-settings-tab'))
                .find(el => ((el as HTMLElement).textContent || '').includes('外观'));
            if (!tab) return false;
            (tab as HTMLElement).click();
            return true;
        });
        expect(switched).toBe(true);

        await expect.poll(async () => page.evaluate(() => {
            const host = window as unknown as {
                app?: { setting?: { activeTab?: { containerEl?: HTMLElement } } };
            };
            const root = host.app?.setting?.activeTab?.containerEl;
            return root?.querySelectorAll('.nw-preset-toolbar').length ?? 0;
        }), { timeout: 15_000 }).toBeGreaterThan(0);

        const facts = await page.evaluate(() => {
            const host = window as unknown as {
                app?: { setting?: { activeTab?: { containerEl?: HTMLElement } } };
            };
            const root = host.app?.setting?.activeTab?.containerEl;
            if (!root) return null;
            const names = Array.from(root.querySelectorAll('.setting-item-name'))
                .map(el => ((el as HTMLElement).textContent || '').trim());
            return {
                hasBase: names.includes('基底色'),
                hasCard: names.includes('卡片色'),
                hasAccent: names.includes('强调色'),
                hasPanel: names.includes('面板色'),
                hasCardToggle: names.includes('启用自定义卡片背景'),
                hasSavePreset: Array.from(root.querySelectorAll('button'))
                    .some(b => ((b as HTMLElement).textContent || '').includes('保存当前配色')),
                swatchCount: root.querySelectorAll('.nw-theme-preview-swatch').length,
            };
        });

        console.log('APPEARANCE_FACTS ' + JSON.stringify(facts));
        expect(facts).not.toBeNull();
        if (!facts) return;

        expect(facts.hasBase).toBe(true);
        expect(facts.hasCard).toBe(true);
        expect(facts.hasAccent).toBe(true);
        expect(facts.hasPanel).toBe(false);
        expect(facts.hasCardToggle).toBe(false);
        expect(facts.swatchCount).toBe(3);
        expect(facts.hasSavePreset).toBe(true);

        // 严格三层：取色器必须恰好 3 个（基底/卡片/强调），
        // 「覆盖文字色」第 4 个已在 v4.22 移除
        const pickerCount = await page.evaluate(() => {
            const host = window as unknown as {
                app?: { setting?: { activeTab?: { containerEl?: HTMLElement } } };
            };
            const root = host.app?.setting?.activeTab?.containerEl;
            if (!root) return -1;
            return root.querySelectorAll('input[type="color"]').length;
        });
        console.log('COLOR_PICKER_COUNT ' + pickerCount);
        expect(pickerCount).toBe(3);

        // 结构验证：五层旧字段不应该存在于设置类型里。
        // 注意：E2E 用全新 vault，没有历史数据可迁移，所以这里断言的是
        // 「新库不会产生旧字段」，迁移本身由 settings-migrator 单测覆盖。
        const migrated = await page.evaluate(() => {
            const host = window as unknown as {
                app?: { plugins?: { plugins?: Record<string, { settings?: Record<string, any> }> } };
            };
            const settings = host.app?.plugins?.plugins?.['novel-writer-ai']?.settings;
            const colors = settings?.themeColors ?? {};
            return {
                hasPanelBg: 'panelBg' in colors,
                hasTextPrimary: 'textPrimary' in colors,
                hasCardToggle: 'enableCustomCardBg' in colors,
            };
        });
        console.log('MIGRATION_STATE ' + JSON.stringify(migrated));
        expect(migrated.hasPanelBg).toBe(false);
        expect(migrated.hasTextPrimary).toBe(false);
        expect(migrated.hasCardToggle).toBe(false);

        // 截图留档：外观设置三层 + 配色方案
        let shotPage = page;
        for (const candidate of page.context().pages()) {
            const found = await candidate
                .evaluate(() => document.querySelectorAll('.nw-preset-toolbar').length)
                .catch(() => 0);
            if (found > 0) { shotPage = candidate; break; }
        }
        const outDir = path.resolve(__dirname, '../../test-results');
        fs.mkdirSync(outDir, { recursive: true });
        await shotPage.screenshot({ path: path.join(outDir, 'appearance-three-layer.png') });

        await page.evaluate(() => {
            const host = window as unknown as { app?: { setting?: { close?(): void } } };
            host.app?.setting?.close?.();
        });
    });

    test('内置主题画廊：点「青瓷·深色」立即切换三层 CSS 变量', async () => {
        const { page } = session;
        expect(await executeCommand(page, SETTINGS_COMMAND)).toBe(true);

        const opened = await page.evaluate(() => {
            const host = window as unknown as {
                app?: { setting?: { activeTab?: { containerEl?: HTMLElement } } };
            };
            const root = host.app?.setting?.activeTab?.containerEl;
            if (!root) return false;
            const tab = Array.from(root.querySelectorAll('.nw-settings-tab'))
                .find(el => ((el as HTMLElement).textContent || '').includes('外观'));
            if (!tab) return false;
            (tab as HTMLElement).click();
            return true;
        });
        expect(opened).toBe(true);

        // 画廊行渲染出来（主题名 + 浅/深两个按钮）
        await expect.poll(async () => page.evaluate(() => {
            const host = window as unknown as {
                app?: { setting?: { activeTab?: { containerEl?: HTMLElement } } };
            };
            const root = host.app?.setting?.activeTab?.containerEl;
            if (!root) return 0;
            return Array.from(root.querySelectorAll('.nw-preset-name'))
                .filter(el => ((el as HTMLElement).textContent || '').includes('青瓷')).length;
        }), { timeout: 15_000 }).toBe(1);

        const clicked = await page.evaluate(() => {
            const host = window as unknown as {
                app?: { setting?: { activeTab?: { containerEl?: HTMLElement } } };
            };
            const root = host.app?.setting?.activeTab?.containerEl;
            if (!root) return false;
            const row = Array.from(root.querySelectorAll('.nw-preset-row'))
                .find(el => ((el as HTMLElement).textContent || '').includes('青瓷'));
            if (!row) return false;
            const darkBtn = Array.from(row.querySelectorAll('button'))
                .find(b => ((b as HTMLElement).textContent || '').trim() === '深色');
            if (!darkBtn) return false;
            (darkBtn as HTMLElement).click();
            return true;
        });
        expect(clicked).toBe(true);

        // 等 CSS 变量真正注入：settings 是同步写入的，只轮询 settings 会在
        // injectThemeVariables()（await saveSettings 之后）执行前就通过，断言到旧样式。
        await expect.poll(async () => page.evaluate(() =>
            getComputedStyle(document.documentElement).getPropertyValue('--nw-app-bg').trim()
        ), { timeout: 15_000 }).toBe('#16211F');

        const state = await page.evaluate(() => {
            const host = window as unknown as {
                app?: { plugins?: { plugins?: Record<string, { settings?: Record<string, unknown> }> } };
            };
            const settings = host.app?.plugins?.plugins?.['novel-writer-ai']?.settings as
                | { theme?: string; themeColors?: { appBg?: string; activePresetId?: string } }
                | undefined;
            return {
                theme: settings?.theme,
                appBg: settings?.themeColors?.appBg,
                activeId: settings?.themeColors?.activePresetId,
                // v4.80 起主题变量走 documentElement.setCssProps，不再注入 <style>；
                // 计算值是唯一可信的「已生效」证据。
                resolvedBg: getComputedStyle(document.documentElement).getPropertyValue('--nw-app-bg').trim(),
            };
        });

        console.log('THEME_GALLERY ' + JSON.stringify(state));
        expect(state.theme).toBe('dark');
        expect(state.appBg).toBe('#16211F');
        expect(state.activeId).toBe('builtin:celadon:dark');
        expect(state.resolvedBg).toBe('#16211F');

        // 还原默认配色，避免影响后续用例的配色假设
        await page.evaluate(async () => {
            const host = window as unknown as {
                app?: {
                    plugins?: {
                        plugins?: Record<string, {
                            settings?: Record<string, unknown>;
                            saveSettings?(): Promise<void>;
                            injectThemeVariables?(): void;
                        }>;
                    };
                };
            };
            const plugin = host.app?.plugins?.plugins?.['novel-writer-ai'];
            if (!plugin?.settings) return;
            plugin.settings.themeColors = {};
            plugin.settings.theme = 'light';
            await plugin.saveSettings?.();
            plugin.injectThemeVariables?.();
        });
        await page.evaluate(() => {
            const host = window as unknown as { app?: { setting?: { close?(): void } } };
            host.app?.setting?.close?.();
        });
    });

    test('桌面宠物显示今日字数，统计弹窗可按日/周/月切换', async () => {
        const { page } = session;

        // 宠物默认开启（移动端不创建；这里是桌面 Electron）
        await expect.poll(async () => page.locator('.nw-pet').count(), { timeout: 15_000 }).toBe(1);

        // 造一章正文（word_count=1500）并让统计服务扫一次，图表才有数据可断言
        const seeded = await page.evaluate(async () => {
            const host = window as unknown as {
                app?: {
                    vault?: {
                        create(path: string, data: string): Promise<unknown>;
                        createFolder(path: string): Promise<unknown>;
                        getAbstractFileByPath(path: string): unknown;
                    };
                    plugins?: { plugins?: Record<string, {
                        writingStats?: { scan(): Promise<void> };
                        refreshWritingSurfaces?(): void;
                    }> };
                };
            };
            const vault = host.app?.vault;
            const plugin = host.app?.plugins?.plugins?.['novel-writer-ai'];
            if (!vault || !plugin) return false;
            const dirs = ['长篇小说', '长篇小说/E2E统计', '长篇小说/E2E统计/03-大纲与章节', '长篇小说/E2E统计/03-大纲与章节/正文', '长篇小说/E2E统计/03-大纲与章节/正文/第1卷'];
            for (const dir of dirs) {
                if (vault.getAbstractFileByPath(dir)) continue;
                try {
                    await vault.createFolder(dir);
                } catch {
                    // 并发创建/已存在：继续
                }
            }
            const path = '长篇小说/E2E统计/03-大纲与章节/正文/第1卷/第1章_正文.md';
            try {
                // 不写 word_count：验证「frontmatter 缺失时按正文字符数兜底」这条路径
                const body = ['---', 'status: written', '---', '', '字'.repeat(1500), ''].join('\n');
                await vault.create(path, body);
            } catch {
                return false;
            }
            await plugin.writingStats?.scan();
            plugin.refreshWritingSurfaces?.();
            return true;
        });
        expect(seeded).toBe(true);

        // 今日字数至少包含刚写的 1500 字（同一次会话里别的用例也会写正文，所以用下界断言）
        await expect.poll(async () => {
            const text = await page.locator('.nw-pet-bubble-main').innerText();
            const matched = text.match(/今日\s*([\d,]+)\s*字/);
            return matched ? parseInt(matched[1].replace(/,/g, ''), 10) : 0;
        }, { timeout: 15_000 }).toBeGreaterThanOrEqual(1500);

        // 单击展开迷你卡（本周/本月/累计/连续）
        await page.locator('.nw-pet-body-wrap').click();
        await expect.poll(async () => page.locator('.nw-pet-card-row').count(), { timeout: 5_000 }).toBe(4);
        const cardLabels = await page.locator('.nw-pet-card-row').allInnerTexts();
        expect(cardLabels.join(' ')).toContain('本周');
        expect(cardLabels.join(' ')).toContain('本月');

        // 双击宠物打开统计弹窗。
        // Obsidian 的 Modal 可能落在独立页面（弹窗窗口），要在所有 page 里找。
        await page.locator('.nw-pet-body-wrap').dblclick();
        const findStatsPage = async () => {
            for (const candidate of page.context().pages()) {
                if (await candidate.locator('.nw-stats-modal').count() > 0) return candidate;
            }
            return null;
        };
        let statsPage = null;
        for (let i = 0; i < 40 && !statsPage; i++) {
            statsPage = await findStatsPage();
            if (!statsPage) await page.waitForTimeout(250);
        }
        expect(statsPage).not.toBeNull();
        const modalPage = statsPage!;

        const tabs = await modalPage.locator('.nw-stats-tab').allInnerTexts();
        expect(tabs).toEqual(['按日', '按周', '按月']);

        // SVG 里的 <text> 不进 innerText，只能读 textContent
        const chartText = async () => (await modalPage.locator('.nw-stats-chart')
            .evaluate(el => el.textContent || '')).replace(/\s+/g, ' ');
        await modalPage.locator('.nw-stats-tab', { hasText: '按周' }).click();
        await expect.poll(chartText, { timeout: 5_000 }).toContain('最近 8 周');
        await modalPage.locator('.nw-stats-tab', { hasText: '按月' }).click();
        await expect.poll(chartText, { timeout: 5_000 }).toContain('最近 6 个月');

        await modalPage.keyboard.press('Escape');

        // 命令切换宠物：隐藏 → 再显示
        expect(await executeCommand(page, TOGGLE_PET_COMMAND)).toBe(true);
        await expect.poll(async () => page.locator('.nw-pet').count(), { timeout: 10_000 }).toBe(0);
        expect(await executeCommand(page, TOGGLE_PET_COMMAND)).toBe(true);
        await expect.poll(async () => page.locator('.nw-pet').count(), { timeout: 10_000 }).toBe(1);
    });

    test('工作台分隔条可拖拽并持久化宽度', async () => {
        const { page } = session;
        const originalViewport = page.viewportSize();
        expect(await executeCommand(page, AGENT_GUIDE_COMMAND)).toBe(true);

        const workbench = page.locator('.workspace-leaf-content[data-type="novel-writer-agent-workbench"]');
        await expect(workbench).toBeVisible({ timeout: 15_000 });

        // 容器 ≤980px 时是单列布局（G5-5），横向分隔条不显示，无法测拖拽；
        // 先把视口拉宽让三栏并排。
        await page.setViewportSize({ width: 1600, height: 950 }).catch(() => undefined);
        await expect.poll(async () => page.evaluate(() => {
            const layout = document.querySelector<HTMLElement>(
                '.workspace-leaf-content[data-type="novel-writer-agent-workbench"] .nw-awb-layout',
            );
            return layout ? getComputedStyle(layout).flexDirection : '';
        }), { timeout: 5_000 }).toBe('row');

        // 分隔条必须存在，且用统一原语（含 role=separator 与 CSS 变量）
        const resizerInfo = await page.evaluate(() => {
            const root = document.querySelector('.workspace-leaf-content[data-type="novel-writer-agent-workbench"]');
            if (!root) return null;
            const resizers = root.querySelectorAll('.nw-panel-resizer');
            const left = root.querySelector<HTMLElement>('.nw-awb-left');
            const right = root.querySelector<HTMLElement>('.nw-awb-right');
            return {
                count: resizers.length,
                hasRole: Array.from(resizers).every(el => el.getAttribute('role') === 'separator'),
                hasTabindex: Array.from(resizers).every(el => el.getAttribute('tabindex') !== null),
                leftVar: left?.style.getPropertyValue('--nw-panel-size') ?? '',
                rightVar: right?.style.getPropertyValue('--nw-panel-size') ?? '',
                leftWidth: Math.round(left?.getBoundingClientRect().width ?? 0),
                rightWidth: Math.round(right?.getBoundingClientRect().width ?? 0),
            };
        });

        console.log('RESIZER_STATE ' + JSON.stringify(resizerInfo));
        expect(resizerInfo).not.toBeNull();
        if (!resizerInfo) return;

        expect(resizerInfo.count).toBeGreaterThanOrEqual(2);
        expect(resizerInfo.hasRole).toBe(true);
        expect(resizerInfo.hasTabindex).toBe(true);
        // 宽度由 CSS 变量驱动，而不是 inline width
        expect(resizerInfo.leftVar).toContain('px');
        expect(resizerInfo.rightVar).toContain('px');

        // 拖拽左分隔条 +60px
        const leftResizer = workbench.locator('.nw-awb-resizer-left').first();
        const box = await leftResizer.boundingBox();
        expect(box).not.toBeNull();
        if (box) {
            await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
            await page.mouse.down();
            await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2, { steps: 8 });
            await page.mouse.up();
            await page.waitForTimeout(400);
        }

        const afterDrag = await page.evaluate(() => {
            const root = document.querySelector('.workspace-leaf-content[data-type="novel-writer-agent-workbench"]');
            const left = root?.querySelector<HTMLElement>('.nw-awb-left');
            const host = window as unknown as {
                app?: { plugins?: { plugins?: Record<string, { settings?: Record<string, any> }> } };
            };
            const settings = host.app?.plugins?.plugins?.['novel-writer-ai']?.settings;
            return {
                width: Math.round(left?.getBoundingClientRect().width ?? 0),
                persisted: settings?.agentWorkbenchLeftWidth ?? null,
            };
        });

        console.log('RESIZER_AFTER_DRAG ' + JSON.stringify(afterDrag));
        // 拖拽后变宽，且写入设置
        expect(afterDrag.width).toBeGreaterThan(resizerInfo.leftWidth + 20);
        expect(afterDrag.persisted).toBeGreaterThan(resizerInfo.leftWidth + 20);

        // 双击复位
        if (box) {
            await leftResizer.dblclick();
            await page.waitForTimeout(400);
        }
        const afterReset = await page.evaluate(() => {
            const root = document.querySelector('.workspace-leaf-content[data-type="novel-writer-agent-workbench"]');
            const left = root?.querySelector<HTMLElement>('.nw-awb-left');
            return Math.round(left?.getBoundingClientRect().width ?? 0);
        });
        console.log('RESIZER_AFTER_RESET ' + afterReset);
        expect(afterReset).toBe(210);

        // G5-5：面板被压窄（窗口仍可很宽）时必须折成单列，且左右栏不能消失
        await page.setViewportSize({ width: 700, height: 950 }).catch(() => undefined);
        await expect.poll(async () => page.evaluate(() => {
            const layout = document.querySelector<HTMLElement>(
                '.workspace-leaf-content[data-type="novel-writer-agent-workbench"] .nw-awb-layout',
            );
            return layout ? getComputedStyle(layout).flexDirection : '';
        }), { timeout: 5_000 }).toBe('column');

        const narrow = await page.evaluate(() => {
            const root = document.querySelector('.workspace-leaf-content[data-type="novel-writer-agent-workbench"]');
            const layout = root?.querySelector<HTMLElement>('.nw-awb-layout');
            const left = root?.querySelector<HTMLElement>('.nw-awb-left');
            const center = root?.querySelector<HTMLElement>('.nw-awb-center');
            const right = root?.querySelector<HTMLElement>('.nw-awb-right');
            const resizer = root?.querySelector<HTMLElement>('.nw-awb-resizer-left');
            const layoutBox = layout?.getBoundingClientRect();
            const centerBox = center?.getBoundingClientRect();
            return {
                layoutWidth: Math.round(layoutBox?.width ?? 0),
                centerWidth: Math.round(centerBox?.width ?? 0),
                leftHeight: Math.round(left?.getBoundingClientRect().height ?? 0),
                rightHeight: Math.round(right?.getBoundingClientRect().height ?? 0),
                leftMaxHeight: left ? getComputedStyle(left).maxHeight : '',
                resizerDisplay: resizer ? getComputedStyle(resizer).display : '',
            };
        });
        console.log('AGENT_NARROW ' + JSON.stringify(narrow));
        expect(narrow.leftHeight).toBeGreaterThan(0);
        expect(narrow.rightHeight).toBeGreaterThan(0);
        expect(narrow.leftMaxHeight).not.toBe('none');
        expect(narrow.resizerDisplay).toBe('none');
        // 单列下中栏必须撑满，不能被 380px 的 flex-basis 卡住。
        // 留 10% 余量：Obsidian 的纵向滚动条（约 12px）会占用容器内容宽度。
        expect(narrow.centerWidth).toBeGreaterThan(narrow.layoutWidth * 0.9);

        if (originalViewport) {
            await page.setViewportSize(originalViewport).catch(() => undefined);
        }
    });

    test('自定义下拉都有可见箭头且文字不被截断', async () => {
        const { page } = session;
        expect(await executeCommand(page, SETTINGS_COMMAND)).toBe(true);

        // 设置页会记住上次停留的标签，先切回「API 配置」
        await expect.poll(async () => page.evaluate(() => {
            const host = window as unknown as {
                app?: { setting?: { activeTab?: { containerEl?: HTMLElement } } };
            };
            const root = host.app?.setting?.activeTab?.containerEl;
            if (!root) return false;
            const tab = Array.from(root.querySelectorAll('.nw-settings-tab'))
                .find(el => ((el as HTMLElement).textContent || '').includes('API 配置'));
            if (!tab) return false;
            (tab as HTMLElement).click();
            return true;
        }), { timeout: 15_000 }).toBe(true);

        // 与其它设置页用例一致：通过 app.setting.activeTab.containerEl 取节点
        await expect.poll(async () => page.evaluate(() => {
            const host = window as unknown as {
                app?: { setting?: { activeTab?: { containerEl?: HTMLElement } } };
            };
            const root = host.app?.setting?.activeTab?.containerEl;
            return root?.querySelectorAll('.nw-api-select').length ?? 0;
        }), { timeout: 15_000 }).toBeGreaterThan(0);

        const facts = await page.evaluate(() => {
            const host = window as unknown as {
                app?: { setting?: { activeTab?: { containerEl?: HTMLElement } } };
            };
            const root = host.app?.setting?.activeTab?.containerEl;
            if (!root) return null;

            const describe = (el: HTMLSelectElement) => {
                const cs = getComputedStyle(el);
                const rect = el.getBoundingClientRect();
                const inner = rect.width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                if (ctx) ctx.font = cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily;
                const widest = Math.max(
                    ...Array.from(el.options).map(o => (ctx ? ctx.measureText(o.text).width : 0)),
                );
                return {
                    cls: el.className,
                    hasArrowImage: cs.backgroundImage !== 'none',
                    blend: cs.backgroundBlendMode,
                    overflowPx: Math.round(widest - inner),
                    textOverflow: cs.textOverflow,
                    optionCount: el.options.length,
                };
            };

            const all = Array.from(
                root.querySelectorAll<HTMLSelectElement>('.nw-api-select, .nw-select'),
            );
            return {
                count: all.length,
                items: all.map(describe),
                apiLabels: Array.from(root.querySelectorAll<HTMLSelectElement>('.nw-api-select'))
                    .flatMap(el => Array.from(el.options).map(o => o.text)),
            };
        });

        console.log('SELECT_FACTS ' + JSON.stringify(facts));
        expect(facts).not.toBeNull();
        if (!facts) return;

        expect(facts.count).toBeGreaterThan(0);
        for (const item of facts.items) {
            // 箭头必须真实可见：有背景图，且没被 Obsidian 的 hard-light 混掉
            expect(item.hasArrowImage).toBe(true);
            expect(item.blend).toBe('normal');
            // 要么文字放得下，要么用省略号优雅降级——不能硬切在笔画中间
            if (item.overflowPx > 2) {
                expect(item.textOverflow).toBe('ellipsis');
            }
        }

        // 协议短名不含路径括号，避免窄面板截断
        for (const label of facts.apiLabels) {
            expect(label).not.toContain('(');
        }

        await page.evaluate(() => {
            const host = window as unknown as { app?: { setting?: { close?(): void } } };
            host.app?.setting?.close?.();
        });
    });

    test('写作工作台三栏可拖拽且布局正常', async () => {
        const { page } = session;

        // 复用前一个用例已创建的项目（不再走一遍向导）
        const opened = await page.evaluate(async () => {
            const host = window as unknown as {
                app?: {
                    vault?: {
                        getAllLoadedFiles?: () => Array<{ path?: string; children?: unknown[] }>;
                        adapter?: { mkdir?: (path: string) => Promise<void> };
                        create?: (path: string, content: string) => Promise<unknown>;
                        getAbstractFileByPath?: (path: string) => unknown;
                        delete?: (file: unknown) => Promise<void>;
                    };
                    plugins?: { plugins?: Record<string, { openChapterInFullWriter?: (project: string, path: string) => void }> };
                };
            };
            const vault = host.app?.vault;
            const files = vault?.getAllLoadedFiles?.() ?? [];
            const root = files.find(f => f.path === '长篇小说');
            const children = (root?.children ?? []) as Array<{ path?: string }>;
            const projectId = children.map(c => c.path).find(p => typeof p === 'string' && p.includes('/E2E项目'));
            if (!projectId) return { ok: false, reason: 'no project' };

            const bodyPath = `${projectId}/03-大纲与章节/正文/第1卷/第1章_正文.md`;
            const folder = bodyPath.split('/').slice(0, -1).join('/');
            await vault?.adapter?.mkdir?.(folder).catch(() => undefined);
            // 文件可能已由上一条用例创建，先删再写（vault.create 遇已存在会抛错）
            const existing = vault?.getAbstractFileByPath?.(bodyPath);
            if (existing) await vault?.delete?.(existing).catch(() => undefined);
            await vault?.create?.(bodyPath, '---\nstatus: drafting\n---\n\n# 第1章\n\nE2E 正文占位。\n')
            host.app?.plugins?.plugins?.['novel-writer-ai']?.openChapterInFullWriter?.(projectId, bodyPath);
            return { ok: true, projectId };
        });

        console.log('FW_OPEN2 ' + JSON.stringify(opened));
        expect(opened.ok).toBe(true);

        const ws = page.locator('.novel-writer-fw-workspace');
        await expect(ws).toBeVisible({ timeout: 30_000 });

        // 三栏横排只在宽视口成立（≤1100px 是刻意的纵向堆叠断点），
        // 这里把窗口拉宽再验证拖拽。
        await page.setViewportSize({ width: 1600, height: 950 }).catch(() => undefined);
        await page.waitForTimeout(600);

        const layout = await page.evaluate(() => {
            const el = document.querySelector<HTMLElement>('.novel-writer-fw-workspace');
            if (!el) return null;
            const cs = getComputedStyle(el);
            const nav = el.querySelector<HTMLElement>('.novel-writer-fw-step-nav');
            const prompt = el.querySelector<HTMLElement>('.novel-writer-fw-prompt-area');
            const ctx = el.querySelector<HTMLElement>('.novel-writer-fw-context-panel');
            const resizers = el.querySelectorAll('.nw-fw-resizer');
            return {
                display: cs.display,
                flexDirection: cs.flexDirection,
                navW: Math.round(nav?.getBoundingClientRect().width ?? 0),
                promptW: Math.round(prompt?.getBoundingClientRect().width ?? 0),
                ctxW: Math.round(ctx?.getBoundingClientRect().width ?? 0),
                resizerCount: resizers.length,
                roles: Array.from(resizers).map(x => x.getAttribute('role')),
                navVar: nav?.style.getPropertyValue('--nw-panel-nav') ?? '',
                ctxVar: ctx?.style.getPropertyValue('--nw-panel-context') ?? '',
            };
        });

        console.log('FW_LAYOUT ' + JSON.stringify(layout));
        expect(layout).not.toBeNull();
        if (!layout) return;

        expect(layout.display).toBe('flex');
        expect(layout.flexDirection).toBe('row');
        expect(layout.resizerCount).toBe(2);
        expect(layout.roles).toEqual(['separator', 'separator']);
        expect(layout.navW).toBeGreaterThan(80);
        expect(layout.ctxW).toBeGreaterThan(120);
        expect(layout.promptW).toBeGreaterThan(layout.navW);
        expect(layout.promptW).toBeGreaterThan(layout.ctxW);
        expect(layout.navVar).toContain('px');
        expect(layout.ctxVar).toContain('px');

        // G6-5：步骤完成后的刷新只重绘本步区域（data-nw-region）。
        // 旧实现每次 renderInContainer(tabContent) 会重建标题栏/导航/上下文面板/分隔条/状态栏。
        const churn = await page.evaluate(() => new Promise<{ added: number; removed: number; regions: number }>((resolve) => {
            const host = window as unknown as {
                app?: { workspace?: { getLeavesOfType(type: string): Array<{ view: unknown }> } };
            };
            const leaves = host.app?.workspace?.getLeavesOfType('novel-writer-full-writer') ?? [];
            const view = leaves[leaves.length - 1]?.view as unknown as {
                tabContent: HTMLElement;
                refreshAfterStep(): void;
            };
            if (!view?.tabContent) { resolve({ added: -1, removed: -1, regions: 0 }); return; }
            const regions = view.tabContent.querySelectorAll('[data-nw-region]').length;
            let added = 0;
            let removed = 0;
            const observer = new MutationObserver((records) => {
                for (const record of records) {
                    added += record.addedNodes.length;
                    removed += record.removedNodes.length;
                }
            });
            observer.observe(view.tabContent, { childList: true, subtree: true });
            view.refreshAfterStep();
            setTimeout(() => {
                observer.disconnect();
                resolve({ added, removed, regions });
            }, 0);
        }));
        console.log('STEP_REFRESH_CHURN ' + JSON.stringify(churn));

        // 分片刷新前必须先有区域标记；没有就说明退化回了旧渲染结构
        expect(churn.regions).toBeGreaterThanOrEqual(7);
        expect(churn.added).toBeGreaterThan(0);
        // 验收口径：单次步骤完成新增节点 <100
        expect(churn.added).toBeLessThan(100);

        // 对照：整页重建的节点数必须明显更高，否则这个测试没有意义
        const fullChurn = await page.evaluate(async () => {
            const host = window as unknown as {
                app?: { workspace?: { getLeavesOfType(type: string): Array<{ view: unknown }> } };
            };
            const leaves = host.app?.workspace?.getLeavesOfType('novel-writer-full-writer') ?? [];
            const view = leaves[leaves.length - 1]?.view as unknown as {
                tabContent: HTMLElement;
                renderInContainer(container: HTMLElement): Promise<void>;
            };
            if (!view?.tabContent) return -1;
            let added = 0;
            const observer = new MutationObserver((records) => {
                for (const record of records) added += record.addedNodes.length;
            });
            observer.observe(view.tabContent, { childList: true, subtree: true });
            await view.renderInContainer(view.tabContent);
            await new Promise(resolve => setTimeout(resolve, 0));
            observer.disconnect();
            return added;
        });
        console.log('STEP_FULL_RENDER_CHURN ' + fullChurn);
        expect(fullChurn).toBeGreaterThan(churn.added);

        // 拖左分隔条 +50px
        const left = page.locator('.nw-fw-resizer-left').first();
        const rbox = await left.boundingBox();
        if (rbox) {
            await page.mouse.move(rbox.x + rbox.width / 2, rbox.y + rbox.height / 2);
            await page.mouse.down();
            await page.mouse.move(rbox.x + rbox.width / 2 + 50, rbox.y + rbox.height / 2, { steps: 6 });
            await page.mouse.up();
            await page.waitForTimeout(500);
        }

        const after = await page.evaluate(() => {
            const el = document.querySelector<HTMLElement>('.novel-writer-fw-workspace');
            const nav = el?.querySelector<HTMLElement>('.novel-writer-fw-step-nav');
            const host = window as unknown as {
                app?: { plugins?: { plugins?: Record<string, { settings?: Record<string, any> }> } };
            };
            const settings = host.app?.plugins?.plugins?.['novel-writer-ai']?.settings;
            return {
                navW: Math.round(nav?.getBoundingClientRect().width ?? 0),
                persisted: settings?.panelSizes?.fwStepNav ?? null,
            };
        });
        console.log('FW_AFTER_DRAG ' + JSON.stringify(after));
        expect(after.navW).toBeGreaterThan(layout.navW + 20);
        expect(after.persisted).toBe(after.navW);
    });

    test('设置行不被压成竖排单字，且任务参数由引擎统一分发', async () => {
        const { page } = session;
        expect(await executeCommand(page, SETTINGS_COMMAND)).toBe(true);

        await expect.poll(async () => page.evaluate(() => {
            const host = window as unknown as {
                app?: { setting?: { activeTab?: { containerEl?: HTMLElement } } };
            };
            return host.app?.setting?.activeTab?.containerEl ? 1 : 0;
        }), { timeout: 15_000 }).toBe(1);

        // 切到 API 配置标签（任务参数区在这里）
        await page.evaluate(() => {
            const host = window as unknown as {
                app?: { setting?: { activeTab?: { containerEl?: HTMLElement } } };
            };
            const root = host.app?.setting?.activeTab?.containerEl;
            const tab = Array.from(root?.querySelectorAll('.nw-settings-tab') ?? [])
                .find(el => ((el as HTMLElement).textContent || '').includes('API 配置'));
            (tab as HTMLElement | undefined)?.click();
        });
        await page.waitForTimeout(800);

        const facts = await page.evaluate(() => {
            const host = window as unknown as {
                app?: { setting?: { activeTab?: { containerEl?: HTMLElement } } };
            };
            const root = host.app?.setting?.activeTab?.containerEl;
            if (!root) return null;

            // 检查所有设置行：名称列不能被压到一行只有一个字
            const squeezed: Array<{ name: string; width: number }> = [];
            for (const nameEl of Array.from(root.querySelectorAll<HTMLElement>('.setting-item-name'))) {
                const text = (nameEl.textContent || '').trim();
                if (text.length < 2) continue;
                const rect = nameEl.getBoundingClientRect();
                // 高度远超一行 → 说明被压成竖排
                const lineHeight = parseFloat(getComputedStyle(nameEl).lineHeight) || 18;
                if (rect.height > lineHeight * 2.5) {
                    squeezed.push({ name: text.slice(0, 20), width: Math.round(rect.width) });
                }
            }

            return {
                squeezed,
                hasBudgetPreview: root.querySelectorAll('.nw-budget-preview').length,
                previewRows: root.querySelectorAll('.nw-budget-row').length,
                hasTierSelect: Array.from(root.querySelectorAll<HTMLSelectElement>('select'))
                    .some(el => Array.from(el.options).some(o => o.value === 'lean')),
                taskCardCount: root.querySelectorAll('.nw-form-grid').length,
            };
        });

        console.log('SETTINGS_LAYOUT ' + JSON.stringify(facts));

        // 截图留档：任务参数全局面板 + 只读分发表
        let shotPage = page;
        for (const candidate of page.context().pages()) {
            const found = await candidate
                .evaluate(() => document.querySelectorAll('.nw-budget-preview').length)
                .catch(() => 0);
            if (found > 0) { shotPage = candidate; break; }
        }
        await shotPage.evaluate(() => {
            document.querySelector<HTMLElement>('.nw-budget-preview')?.scrollIntoView({ block: 'center' });
        });
        await shotPage.waitForTimeout(400);
        await shotPage.screenshot({ path: 'test-results/budget-engine-panel.png' });

        expect(facts).not.toBeNull();
        if (!facts) return;

        // 核心回归：没有任何设置行被压成竖排单字
        expect(facts.squeezed).toEqual([]);
        // 任务参数改成「一张全局面板 + 只读分发表」
        expect(facts.hasTierSelect).toBe(true);
        expect(facts.hasBudgetPreview).toBe(1);
        expect(facts.previewRows).toBe(6);

        await page.evaluate(() => {
            const host = window as unknown as { app?: { setting?: { close?(): void } } };
            host.app?.setting?.close?.();
        });
    });

    test('知识库侧栏的模型切换器不溢出侧栏', async () => {
        const { page } = session;

        // 宽视口才不触发 @container (max-width: 860px) 的堆叠布局，
        // 侧栏才保持 200px 固定宽度——用户截图就是这个状态。
        await page.setViewportSize({ width: 1600, height: 950 }).catch(() => undefined);
        await page.waitForTimeout(500);
        expect(await executeCommand(page, toObsidianCommandId('novel-writer-open-knowledge-base'))).toBe(true);

        const view = page.locator('.nw-kb-left-sidebar');
        await expect(view).toBeVisible({ timeout: 20_000 });

        // 等切换器真正完成布局：renderLeftSidebar 会 empty 重建，
        // 过早测量会拿到 0 宽度，断言就变成空过。
        await expect.poll(async () => page.evaluate(() => {
            const btn = document.querySelector<HTMLElement>('.nw-kb-left-sidebar .nw-model-switch');
            return btn ? Math.round(btn.getBoundingClientRect().width) : 0;
        }), { timeout: 15_000 }).toBeGreaterThan(40);

        const facts = await page.evaluate(() => {
            const sidebar = document.querySelector<HTMLElement>('.nw-kb-left-sidebar');
            const header = document.querySelector<HTMLElement>('.nw-kb-sidebar-header');
            const btn = sidebar?.querySelector<HTMLElement>('.nw-model-switch') ?? null;
            const label = btn?.querySelector<HTMLElement>('.nw-model-switch-label');
            if (!sidebar || !btn) return null;
            const s = sidebar.getBoundingClientRect();
            const b = btn.getBoundingClientRect();
            const h = header?.getBoundingClientRect();
            const cs = label ? getComputedStyle(label) : null;
            return {
                sidebarW: Math.round(s.width),
                sidebarRight: Math.round(s.right),
                buttonRight: Math.round(b.right),
                buttonW: Math.round(b.width),
                overflowRight: Math.round(b.right - s.right),
                headerContentW: h
                    ? Math.round(h.width - parseFloat(getComputedStyle(header!).paddingLeft)
                        - parseFloat(getComputedStyle(header!).paddingRight))
                    : null,
                labelEllipsis: cs?.textOverflow ?? null,
                buttonMaxWidth: getComputedStyle(btn).maxWidth,
            };
        });

        console.log('KB_SWITCHER ' + JSON.stringify(facts));
        expect(facts).not.toBeNull();
        if (!facts) return;

        // 先确保真的量到了按钮（否则下面的断言会因为 0 宽度而空过）
        expect(facts.buttonW).toBeGreaterThan(40);
        // 核心回归：切换器必须完全落在侧栏内（旧值溢出 48px）
        expect(facts.overflowRight).toBeLessThanOrEqual(0);
        // 宽度不得超过 header 内容区
        expect(facts.buttonW).toBeLessThanOrEqual((facts.headerContentW ?? 0) + 1);
        // 放不下时用省略号，而不是硬切
        expect(facts.labelEllipsis).toBe('ellipsis');
        // max-width 必须跟容器走，不能是固定 280px
        expect(facts.buttonMaxWidth).not.toBe('280px');

        // 指纹库侧栏挂的是同一个组件（300px 侧栏），一并校验不溢出
        expect(await executeCommand(page, toObsidianCommandId('novel-writer-fingerprint-library'))).toBe(true);
        await expect.poll(async () => page.evaluate(() => {
            const btn = document.querySelector<HTMLElement>('.nw-fingerprint-left-sidebar .nw-model-switch');
            return btn ? Math.round(btn.getBoundingClientRect().width) : 0;
        }), { timeout: 15_000 }).toBeGreaterThan(40);

        const fpFacts = await page.evaluate(() => {
            const sidebar = document.querySelector<HTMLElement>('.nw-fingerprint-left-sidebar');
            const btn = sidebar?.querySelector<HTMLElement>('.nw-model-switch') ?? null;
            if (!sidebar || !btn) return null;
            const s = sidebar.getBoundingClientRect();
            const b = btn.getBoundingClientRect();
            return {
                sidebarW: Math.round(s.width),
                buttonW: Math.round(b.width),
                overflowRight: Math.round(b.right - s.right),
            };
        });

        console.log('FP_SWITCHER ' + JSON.stringify(fpFacts));
        expect(fpFacts).not.toBeNull();
        if (fpFacts) {
            expect(fpFacts.buttonW).toBeGreaterThan(40);
            expect(fpFacts.overflowRight).toBeLessThanOrEqual(0);
        }
    });

    test('指纹库作用域页签不乱序、搜索框不被挤到列表下方、启停开关真的翻转', async () => {
        const { page } = session;

        expect(await executeCommand(page, toObsidianCommandId('novel-writer-fingerprint-library'))).toBe(true);
        await expect(page.locator('.nw-fingerprint-left-sidebar')).toBeVisible({ timeout: 20_000 });

        // 直接调视图方法注入一条指纹：E2E 不依赖 embedding/AI 是否可用
        const injected = await page.evaluate(async () => {
            const host = window as unknown as {
                app?: { workspace?: { getLeavesOfType(type: string): Array<{ view: unknown }> } };
            };
            const leaves = host.app?.workspace?.getLeavesOfType('novel-writer-writing-fingerprint') ?? [];
            const view = leaves[0]?.view as unknown as {
                fingerprintLibrary?: { addGlobal(fp: unknown): Promise<void> };
                loadAllFingerprints(): Promise<void>;
                renderSearchAndFilter(): void;
                renderFingerprintList(): void;
                renderDetailPanel(): void;
            };
            if (!view?.fingerprintLibrary) return false;

            await view.fingerprintLibrary.addGlobal({
                id: 'e2e-fp-1',
                name: 'E2E 测试指纹',
                source: 'E2E',
                scope: 'global',
                enabled: true,
                tags: ['e2e'],
                stats: {
                    avgSentenceLength: 12,
                    avgParagraphLength: 40,
                    dialogueRatio: 0.3,
                    descriptionRatio: 0.2,
                    wordCount: 1000,
                },
                features: {
                    sentenceRhythm: '短句为主，节奏紧凑',
                    wordPreference: '口语化用词',
                    narrativeStyle: '第三人称限制视角',
                    rhetoric: '少用修辞',
                    dialogueStyle: '短句对白',
                    paragraphStructure: '段落短小',
                    overallTone: '清冷克制',
                },
                samples: ['示例片段一。'],
                extractedAt: Date.now(),
            });
            await view.loadAllFingerprints();
            // 单独重渲染搜索区（旧实现会把它追加到列表下方）
            view.renderSearchAndFilter();
            view.renderFingerprintList();
            view.renderDetailPanel();
            return true;
        });
        expect(injected).toBe(true);

        // 切到全局层，确认注入的指纹可见
        await page.locator('.nw-fingerprint-scope-tab', { hasText: '全局层' }).click();
        await expect(page.locator('.nw-fingerprint-list-item')).toHaveCount(1);

        const order = await page.evaluate(() => {
            const following = (a: Element | null, b: Element | null): boolean => {
                if (!a || !b) return false;
                // DOCUMENT_POSITION_FOLLOWING = 4
                return (a.compareDocumentPosition(b) & 4) === 4;
            };
            const sidebar = document.querySelector('.nw-fingerprint-left-sidebar');
            const tabs = sidebar?.querySelector('.nw-fingerprint-scope-tabs') ?? null;
            const toolbar = sidebar?.querySelector('.nw-fingerprint-toolbar') ?? null;
            const search = sidebar?.querySelector('.nw-fingerprint-search-container') ?? null;
            const list = sidebar?.querySelector('.nw-fingerprint-list') ?? null;
            const modelSwitch = sidebar?.querySelector('.nw-model-switch') ?? null;
            return {
                tabCount: document.querySelectorAll('.nw-fingerprint-scope-tab').length,
                tabsBeforeToolbar: following(tabs, toolbar),
                searchBeforeList: following(search, list),
                modelSwitchBeforeTabs: following(modelSwitch, tabs),
            };
        });

        console.log('FP_ORDER ' + JSON.stringify(order));
        expect(order.tabCount).toBe(3);
        expect(order.tabsBeforeToolbar).toBe(true);
        expect(order.searchBeforeList).toBe(true);
        expect(order.modelSwitchBeforeTabs).toBe(true);

        // 选中并点工具栏「启用/禁用」：落盘状态必须真的翻转
        await page.locator('.nw-fingerprint-list-item').first().click();
        await expect(page.locator('.nw-fingerprint-right-panel')).toContainText('E2E 测试指纹');

        await page.locator('.nw-fingerprint-toolbar-btn', { hasText: '启用/禁用' }).click();

        const stateAfter = await page.evaluate(async () => {
            const host = window as unknown as {
                app?: { workspace?: { getLeavesOfType(type: string): Array<{ view: unknown }> } };
            };
            const view = host.app?.workspace?.getLeavesOfType('novel-writer-writing-fingerprint')[0]?.view as unknown as {
                fingerprintLibrary?: { activeProject?: string; getGlobal(id: string): { enabled: boolean } | undefined };
                effectiveGlobalEnabled?: Map<string, boolean>;
                loadAllFingerprints(): Promise<void>;
            };
            if (!view?.fingerprintLibrary) return null;
            await view.loadAllFingerprints();
            return {
                // 有活动项目时开关写的是「项目级覆盖」，只有生效状态一定会翻转
                effective: view.effectiveGlobalEnabled?.get('e2e-fp-1') ?? null,
                rawGlobal: view.fingerprintLibrary.getGlobal('e2e-fp-1')?.enabled ?? null,
                project: view.fingerprintLibrary.activeProject ?? null,
            };
        });

        console.log('FP_TOGGLE ' + JSON.stringify(stateAfter));
        expect(stateAfter).not.toBeNull();
        expect(stateAfter?.effective).toBe(false);
        // 没有项目时才允许改全局默认值
        if (stateAfter && !stateAfter.project) {
            expect(stateAfter.rawGlobal).toBe(false);
        } else {
            expect(stateAfter?.rawGlobal).toBe(true);
        }
    });

    test('知识库「拆解任务 / 质量统计」增量刷新不会重复追加整块 UI', async () => {
        const { page } = session;

        expect(await executeCommand(page, toObsidianCommandId('novel-writer-open-knowledge-base'))).toBe(true);
        await expect(page.locator('.nw-kb-left-sidebar')).toBeVisible({ timeout: 20_000 });

        // 直接调用视图的渲染方法，模拟进度/完成回调走的「增量刷新」路径
        // （正常点页签会先 renderRightPanel → empty，掩盖了这个缺陷）
        const result = await page.evaluate(() => {
            const host = window as unknown as {
                app?: { workspace?: { getLeavesOfType(type: string): Array<{ view: unknown }> } };
            };
            const leaves = host.app?.workspace?.getLeavesOfType('novel-writer-knowledge-base') ?? [];
            const view = leaves[0]?.view as unknown as {
                activeMainTab?: string;
                renderRightPanel(): void;
                renderTasksTab(): void;
                renderStatsTab(): void;
            };
            if (!view) return null;

            view.activeMainTab = 'tasks';
            view.renderRightPanel();
            // 进度回调每秒可能触发几十次，这里连打三次
            view.renderTasksTab();
            view.renderTasksTab();
            view.renderTasksTab();
            const taskBlocks = document.querySelectorAll('.nw-kb-tasks-tab').length;

            view.activeMainTab = 'stats';
            view.renderRightPanel();
            view.renderStatsTab();
            view.renderStatsTab();
            const statsBlocks = document.querySelectorAll('.nw-kb-stats-tab').length;

            return { taskBlocks, statsBlocks };
        });

        console.log('KB_TABS ' + JSON.stringify(result));
        expect(result).not.toBeNull();
        // 旧实现在每次增量刷新时 createDiv 追加：3 次 → 4 块、2 次 → 3 块
        expect(result?.taskBlocks).toBe(1);
        expect(result?.statsBlocks).toBe(1);
    });

    test('协同写作：程序化插入会排自动保存并真正落盘，字体设置重开仍生效', async () => {
        const { page } = session;

        expect(await executeCommand(page, toObsidianCommandId('novel-writer-co-writing'))).toBe(true);
        await expect(page.locator('.nw-cowrite-editor')).toBeVisible({ timeout: 20_000 });

        // 直接在视图上执行「程序化写入 → 排自动保存 → 保存」，不依赖 AI/绑定流程
        const result = await page.evaluate(async () => {
            const host = window as unknown as {
                app?: {
                    workspace?: { getLeavesOfType(type: string): Array<{ view: unknown }> };
                    vault?: {
                        getAbstractFileByPath(path: string): { children?: Array<{ path: string; name: string }> } | null;
                        adapter?: { read(path: string): Promise<string> };
                    };
                };
                localStorage?: Storage;
            };
            const leaves = host.app?.workspace?.getLeavesOfType('novel-writer-co-writing') ?? [];
            const view = leaves[0]?.view as unknown as {
                project: string;
                volume: string;
                chapterName: string;
                chapterNum: number;
                rightEditor: HTMLTextAreaElement | null;
                autoSaveDebouncer?: { hasPending(key: string): boolean };
                applyProgrammaticEdit(text: string, cursor: number, reason: string): void;
                saveBody(showNotice: boolean): Promise<boolean>;
                getBodyPath(): string;
            };
            if (!view?.rightEditor) return null;

            // 找到 E2E 创建的项目；单独跑本用例时可能还没有，就建一个最小项目目录
            const novelRoot = host.app?.vault?.getAbstractFileByPath('长篇小说');
            let projectPath = novelRoot?.children?.find(child => child.name.startsWith('E2E项目'))?.path;
            if (!projectPath) {
                const vault = host.app?.vault as unknown as {
                    getAbstractFileByPath(path: string): unknown;
                    createFolder(path: string): Promise<unknown>;
                };
                for (const path of ['长篇小说', '长篇小说/E2E协同写作项目']) {
                    if (!vault.getAbstractFileByPath(path)) {
                        await vault.createFolder(path).catch(() => undefined);
                    }
                }
                projectPath = '长篇小说/E2E协同写作项目';
            }

            view.project = projectPath;
            view.volume = '第1卷';
            view.chapterName = '第1章';
            view.chapterNum = 1;

            const inserted = `E2E 程序化写入的正文 ${Date.now()}。`;
            view.applyProgrammaticEdit(`${view.rightEditor.value}${inserted}`, 0, 'e2e-programmatic-edit');
            // P0 回归：程序化写入必须自己排自动保存（旧实现只认 input 事件）
            const pending = view.autoSaveDebouncer?.hasPending('auto-save') ?? false;
            const saved = await view.saveBody(false);

            const bodyPath = view.getBodyPath();
            const content = await host.app?.vault?.adapter?.read(bodyPath).catch(() => '') ?? '';
            return { pending, saved, bodyPath, hasText: content.includes(inserted), inserted };
        });

        console.log('COWRITE_PROGRAMMATIC ' + JSON.stringify({ ...result, inserted: undefined }));
        expect(result).not.toBeNull();
        expect(result?.pending).toBe(true);
        expect(result?.saved).toBe(true);
        expect(result?.hasText).toBe(true);

        // 字体恢复：设置后重开视图，编辑器必须直接带上该字体（旧实现只在下拉 change 时应用）
        await page.evaluate(async () => {
            const host = window as unknown as {
                app?: {
                    plugins?: { plugins?: Record<string, { settings: Record<string, unknown>; saveSettings(): Promise<void> }> };
                    workspace?: { getLeavesOfType(type: string): Array<{ detach(): Promise<void> }> };
                };
            };
            const plugin = host.app?.plugins?.plugins?.['novel-writer-ai'];
            if (!plugin) return;
            plugin.settings.coWriteEditorFont = 'serif';
            await plugin.saveSettings();
            const leaf = host.app?.workspace?.getLeavesOfType('novel-writer-co-writing')[0];
            await leaf?.detach();
        });
        expect(await executeCommand(page, toObsidianCommandId('novel-writer-co-writing'))).toBe(true);
        await expect(page.locator('.nw-cowrite-editor')).toBeVisible({ timeout: 20_000 });
        await expect.poll(async () => page.evaluate(() => {
            const el = document.querySelector<HTMLTextAreaElement>('.nw-cowrite-editor');
            return el?.style.fontFamily ?? '';
        }), { timeout: 10_000 }).toBe('serif');
    });

    test('右侧项目速览面板：属性可写回、标签可见、Bases 看板可生成', async () => {
        const { page, vault } = session;
        const projectPath = '长篇小说/E2E面板项目';
        const chapterPath = `${projectPath}/03-大纲与章节/正文/第1卷/第1章_正文.md`;

        // 准备一个最小章节文件（带旧扁平标签，验证层级标签识别与属性面板）
        const prepared = await page.evaluate(async ({ project, chapter }) => {
            const host = window as unknown as {
                app?: {
                    vault?: {
                        getAbstractFileByPath(path: string): unknown;
                        createFolder(path: string): Promise<unknown>;
                        create(path: string, content: string): Promise<unknown>;
                        adapter?: { write(path: string, content: string): Promise<void> };
                    };
                };
            };
            const vault = host.app?.vault;
            if (!vault?.adapter) return false;
            for (const folder of [
                project,
                `${project}/03-大纲与章节`,
                `${project}/03-大纲与章节/正文`,
                `${project}/03-大纲与章节/正文/第1卷`,
            ]) {
                if (!vault.getAbstractFileByPath(folder)) await vault.createFolder(folder).catch(() => undefined);
            }
            const body = ['---', 'tags: [正文, nw/正文]', '卷: "第1卷"', '章: "第1章"', '标题: ""', 'status: pending', 'word_count: 0', '---', '', '# 第1章', '', '正文。'].join('\n');
            if (!vault.getAbstractFileByPath(chapter)) await vault.create(chapter, body);
            return true;
        }, { project: projectPath, chapter: chapterPath });
        expect(prepared).toBe(true);

        // 打开章节文件（面板跟随活动文件）
        await page.evaluate(async (path) => {
            const host = window as unknown as {
                app?: {
                    vault?: { getAbstractFileByPath(p: string): unknown };
                    workspace?: { getLeaf(arg?: unknown): { openFile(file: unknown): Promise<void> } };
                };
            };
            const file = host.app?.vault?.getAbstractFileByPath(path);
            if (file) await host.app?.workspace?.getLeaf('tab')?.openFile(file);
        }, chapterPath);
        await page.waitForTimeout(800);

        // 打开右侧面板
        await page.evaluate(async () => {
            const host = window as unknown as {
                app?: { plugins?: { plugins?: Record<string, { openProjectSidePanel(): Promise<void> }> } };
            };
            await host.app?.plugins?.plugins?.['novel-writer-ai']?.openProjectSidePanel();
        });

        await expect(page.locator('.nw-side-panel')).toBeVisible({ timeout: 15_000 });
        await expect(page.locator('.nw-side-panel-file-kind')).toHaveText('章节正文');
        await expect(page.locator('.nw-side-panel-section-title').filter({ hasText: '本文件属性' })).toHaveCount(1);
        await expect(page.locator('.nw-side-panel-section-title').filter({ hasText: '快捷动作' })).toHaveCount(1);
        await expect(page.locator('.nw-side-panel-tag.is-ns')).toHaveCount(1);

        // 改 status → 读盘断言 frontmatter 变更
        const statusSelect = page.locator('.nw-side-panel-prop').filter({ hasText: '状态' }).locator('select');
        await statusSelect.selectOption('written');
        await expect.poll(async () => page.evaluate(async (path) => {
            const host = window as unknown as { app?: { vault?: { adapter?: { read(p: string): Promise<string> } } } };
            return host.app?.vault?.adapter?.read(path).catch(() => '') ?? '';
        }, chapterPath), { timeout: 15_000 }).toContain('status: written');

        // 生成项目看板：先写入工作台上下文，再执行命令，最后严格断言文件落盘
        await page.evaluate((project) => {
            const host = window as unknown as {
                app?: { plugins?: { plugins?: Record<string, {
                    setWorkbenchContext(ctx: unknown): void;
                    registry?: { execute(id: string): unknown };
                }> } };
            };
            const plugin = host.app?.plugins?.plugins?.['novel-writer-ai'];
            plugin?.setWorkbenchContext({ project, volume: '', chapterName: '', chapterNum: 0, chapDir: '' });
            plugin?.registry?.execute('novel-writer-generate-bases');
        }, projectPath);

        const basePath = `${projectPath}/.看板/章节进度.base`;
        await expect.poll(async () => page.evaluate(async (path) => {
            const host = window as unknown as { app?: { vault?: { adapter?: { exists(p: string): Promise<boolean> } } } };
            const adapter = host.app?.vault?.adapter;
            return adapter ? await adapter.exists(path).catch(() => false) : false;
        }, basePath), { timeout: 15_000 }).toBe(true);

        const baseContent = await page.evaluate(async (path) => {
            const host = window as unknown as { app?: { vault?: { adapter?: { read(p: string): Promise<string> } } } };
            return host.app?.vault?.adapter?.read(path).catch(() => '') ?? '';
        }, basePath);
        expect(baseContent).toContain('file.hasTag("nw/正文")');
        expect(baseContent).toContain(`file.inFolder("${projectPath}")`);
        expect(baseContent).toContain('name: "章节进度"');
    });

    test('长流程执行登记表：命令跑完后 Agent 可读到结果', async () => {
        const { page } = session;
        // 复用面板用例已建好的项目（章节文件齐全，看板能生成）
        const projectPath = '长篇小说/E2E面板项目';

        const readRecords = () => page.evaluate(() => {
            const host = window as unknown as {
                app?: { plugins?: { plugins?: Record<string, {
                    getExecutionLedgerRecords(limit?: number): Array<Record<string, unknown>>;
                }> } };
            };
            const plugin = host.app?.plugins?.plugins?.['novel-writer-ai'];
            return plugin?.getExecutionLedgerRecords?.(10) ?? [];
        });

        const matching = (records: Array<Record<string, unknown>>) => records
            .filter(record => record.commandId === 'novel-writer-generate-bases');

        // 面板用例可能已经跑过一次同名命令：以「本次新增的记录」为准
        const before = matching(await readRecords() as Array<Record<string, unknown>>).length;

        await page.evaluate((project) => {
            const host = window as unknown as {
                app?: { plugins?: { plugins?: Record<string, {
                    setWorkbenchContext(ctx: unknown): void;
                    registry?: { execute(id: string): unknown };
                }> } };
            };
            const plugin = host.app?.plugins?.plugins?.['novel-writer-ai'];
            plugin?.setWorkbenchContext({ project, volume: '', chapterName: '', chapterNum: 0, chapDir: '' });
            plugin?.registry?.execute('novel-writer-generate-bases');
        }, projectPath);

        // 等到「本次新增的那条」进入完成态（写盘异步，先出现的是 running）
        await expect.poll(async () => {
            const records = matching(await readRecords() as Array<Record<string, unknown>>);
            if (records.length <= before) return 'none';
            return String(records[0]?.status ?? '');
        }, { timeout: 20_000 }).toBe('done');

        const records = matching(await readRecords() as Array<Record<string, unknown>>);
        // 幂等回归：同一项目连跑两次都必须成功（.看板 是隐藏目录，走 vault API 会 File already exists）
        expect(records.length).toBeGreaterThan(before);
        expect(String(records[0]?.detail ?? '')).toContain('看板');
        expect(records.every(record => record.status === 'done')).toBe(true);
    });

    test('短篇：创建后落在创作流程页，单元工作台可写正文并回写状态', async () => {
        const { page } = session;
        const projectPath = '短篇小说/E2E短篇项目';
        const bodyPath = `${projectPath}/短篇创作/03-正文/第01节.md`;
        const outlinePath = `${projectPath}/短篇创作/02-分节大纲/分节大纲.md`;

        const prepared = await page.evaluate(async ({ project, body, outline }) => {
            const host = window as unknown as {
                app?: {
                    vault?: {
                        getAbstractFileByPath(path: string): unknown;
                        createFolder(path: string): Promise<unknown>;
                        create(path: string, content: string): Promise<unknown>;
                        adapter?: {
                            write(path: string, content: string): Promise<void>;
                            read(path: string): Promise<string>;
                        };
                    };
                };
            };
            const vault = host.app?.vault;
            if (!vault?.adapter) return { ok: false, reason: 'no vault' };

            const folders = [
                project,
                `${project}/00-前期调研`,
                `${project}/短篇创作`,
                `${project}/短篇创作/01-故事核`,
                `${project}/短篇创作/02-分节大纲`,
                `${project}/短篇创作/03-正文`,
            ];
            for (const folder of folders) {
                if (!vault.getAbstractFileByPath(folder)) await vault.createFolder(folder).catch(() => undefined);
            }

            await vault.adapter.write(`${project}/.project`, [
                '## 创作模式', 'short',
                '', '## 短篇分类', '都市情感',
                '', '## 目标字数', '80000',
                '', '## 目标节数', '2',
            ].join('\n'));

            await vault.adapter.write(`${project}/00-前期调研/调研数据.json`, JSON.stringify({
                mode: 'short',
                name: 'E2E短篇项目',
                primaryCategory: '都市情感',
                targetWords: 80000,
                targetSections: 2,
                premise: '失忆的档案员找回身份',
                coreConflict: '记忆被人为篡改',
                emotionalPromise: '揭开真相的爽感',
                reversals: '两次反转',
                endingPayoff: '完成自证',
                plotTags: '',
                characterCore: '主角：失忆的档案员',
                emotionCurve: '',
                background: '',
                audience: '',
                references: '',
                notes: '',
            }, null, 2));

            const outlineText = [
                '# 分节大纲',
                '',
                '## 第1节 失忆',
                '- 目标：交代主角失忆',
                '- 冲突：档案被销毁',
                '- 反转：档案里出现自己的名字',
                '- 结尾钩子：陌生来电',
                '',
                '## 第2节 追查',
                '- 目标：追查档案来源',
                '',
            ].join('\n');
            if (!vault.getAbstractFileByPath(outline)) await vault.create(outline, outlineText);

            const skeleton = [
                '---',
                '节: "第1节"',
                'status: pending',
                'word_count: 0',
                '---',
                '',
                '# 第1节',
                '',
                '## 本节目标',
                '- 核心冲突：',
                '',
            ].join('\n');
            if (!vault.getAbstractFileByPath(body)) await vault.create(body, skeleton);

            const storyCore = `${project}/短篇创作/01-故事核/故事核.md`;
            if (!vault.getAbstractFileByPath(storyCore)) {
                await vault.create(storyCore, '# 故事核\n\n一句话故事：失忆档案员找回身份。\n核心冲突：记忆被篡改。\n');
            }
            return { ok: true };
        }, { project: projectPath, body: bodyPath, outline: outlinePath });
        expect(prepared.ok).toBe(true);

        // 与「前期调研创建完成」同一个入口：打开工作台并落在该项目的创作流程页
        await page.evaluate(async (project) => {
            const host = window as unknown as {
                app?: { plugins?: { plugins?: Record<string, { openCreationFlow(project?: string): Promise<void> }> } };
            };
            await host.app?.plugins?.plugins?.['novel-writer-ai']?.openCreationFlow(project);
        }, projectPath);

        await expect(page.locator('.nw-flow-panel')).toBeVisible({ timeout: 20_000 });
        await expect(page.locator('.nw-flow-stage')).toHaveCount(4);
        await expect(page.locator('.nw-flow-stage-title').filter({ hasText: '前期调研' })).toHaveCount(1);
        // 调研与大纲都已就绪 → 下一步必须是分节写作，而不是「打开项目与章节」这类空提示
        await expect(page.locator('.nw-flow-next-title')).toHaveText('分节写作');

        await page.locator('.nw-flow-next-actions button').first().click();
        await expect(page.locator('.nw-unit-panel')).toBeVisible({ timeout: 20_000 });
        await expect(page.locator('.nw-unit-editor')).toBeVisible();

        const text = '失忆后的第七天，我在档案室的最后一排找到了自己的名字。'.repeat(4);
        await page.locator('.nw-unit-editor').fill(text);
        await page.getByRole('button', { name: /完成本节/ }).click();

        await expect.poll(async () => {
            return page.evaluate(async (path) => {
                const host = window as unknown as {
                    app?: { vault?: { adapter?: { read(p: string): Promise<string> } } };
                };
                return host.app?.vault?.adapter?.read(path).catch(() => '') ?? '';
            }, bodyPath);
        }, { timeout: 15_000 }).toContain('status: written');

        const finalContent = await page.evaluate(async (path) => {
            const host = window as unknown as {
                app?: { vault?: { adapter?: { read(p: string): Promise<string> } } };
            };
            return host.app?.vault?.adapter?.read(path).catch(() => '') ?? '';
        }, bodyPath);
        expect(finalContent).toContain('失忆后的第七天');
        expect(finalContent).toMatch(/word_count:\s*[1-9]\d*/);

        // 完成唯一的节之后，下一步应是导出；格式下拉必须提供 TXT / EPUB / DOCX
        await expect(page.locator('.nw-flow-next-title')).toHaveText('导出成稿');

        // 在项目内放一张 1×1 PNG 封面（约定：封面/cover.png），导出 EPUB 时应被嵌入
        const coverPng = [
            0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
            0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
            0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
            0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
            0x42, 0x60, 0x82,
        ];
        const coverCreated = await page.evaluate(async ({ project, png }) => {
            const host = window as unknown as {
                app?: {
                    vault?: {
                        getAbstractFileByPath(path: string): unknown;
                        createFolder(path: string): Promise<unknown>;
                        createBinary(path: string, data: ArrayBuffer): Promise<unknown>;
                    };
                };
            };
            const vault = host.app?.vault;
            if (!vault) return false;
            const coverDir = `${project}/封面`;
            if (!vault.getAbstractFileByPath(coverDir)) await vault.createFolder(coverDir).catch(() => undefined);
            if (!vault.getAbstractFileByPath(`${coverDir}/cover.png`)) {
                const buffer = new Uint8Array(png).buffer;
                await vault.createBinary(`${coverDir}/cover.png`, buffer);
            }
            return vault.getAbstractFileByPath(`${coverDir}/cover.png`) != null;
        }, { project: projectPath, png: coverPng });
        expect(coverCreated).toBe(true);

        await page.locator('.nw-flow-next-actions button').first().click();

        const exportModalPage = await waitForModalPage(page, 15_000);
        const exportModal = exportModalPage.locator('.modal-container').last();
        await expect(exportModal).toBeVisible();

        const formatSelect = await (async () => {
            const selects = exportModal.locator('select');
            const count = await selects.count();
            for (let index = 0; index < count; index++) {
                const labels = await selects.nth(index).locator('option').allTextContents();
                if (labels.some(label => label.includes('EPUB'))) return selects.nth(index);
            }
            return null;
        })();
        expect(formatSelect).not.toBeNull();
        const formatLabels = (await formatSelect!.locator('option').allTextContents()).join('|');
        expect(formatLabels).toContain('TXT');
        expect(formatLabels).toContain('EPUB');
        expect(formatLabels).toMatch(/docx/i);

        // 桌面下载无法在测试里落盘：临时把 app.isMobile 置真，让导出走
        // vault 的「导出文件」目录，再按 ZIP 头校验 EPUB 真的生成了。
        const mobileOverridden = await page.evaluate(() => {
            const host = window as unknown as { app?: object };
            try {
                Object.defineProperty(host.app as object, 'isMobile', { value: true, configurable: true });
                return true;
            } catch {
                return false;
            }
        });
        expect(mobileOverridden).toBe(true);

        await formatSelect!.selectOption('epub');

        // 成品档（默认）EPUB/DOCX 必须填作者：按真实用户路径补上作者，而不是降档绕过检查
        const authorSettingRow = exportModal.locator('.setting-item', {
            has: exportModalPage.locator('.setting-item-name', { hasText: '作者' }),
        });
        await expect(authorSettingRow).toBeVisible();
        await authorSettingRow.locator('input[type="text"]').first().fill('E2E 作者');

        await exportModal.getByRole('button', { name: '导出', exact: true }).click();

        await expect.poll(() => {
            const dir = path.join(session.vault.path, '导出文件');
            return fs.existsSync(dir)
                ? fs.readdirSync(dir).filter(name => name.endsWith('.epub'))
                : [];
        }, { timeout: 20_000 }).not.toHaveLength(0);

        const epubDir = path.join(session.vault.path, '导出文件');
        const epubName = fs.readdirSync(epubDir).find(name => name.endsWith('.epub'))!;
        const epubBytes = fs.readFileSync(path.join(epubDir, epubName));
        expect([...epubBytes.subarray(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
        expect(epubBytes.includes(Buffer.from('application/epub+zip'))).toBe(true);
        // 封面：ZIP 是 store 模式，PNG 字节与 OPF 声明都应原样出现在文件里
        expect(epubBytes.includes(Buffer.from(coverPng))).toBe(true);
        expect(epubBytes.includes(Buffer.from('properties="cover-image"'))).toBe(true);
        expect(epubBytes.includes(Buffer.from('images/cover.png'))).toBe(true);

        // 恢复真实端标识，避免后续用例的导出都改走 vault 分支
        await page.evaluate(() => {
            const host = window as unknown as { app?: object };
            try {
                Object.defineProperty(host.app as object, 'isMobile', { value: false, configurable: true });
            } catch {
                // 忽略：仅测试环境需要
            }
        });
    });

    test('完整写作工作台：运行进度条不会被步骤重渲染清掉', async () => {
        const { page } = session;

        // 复用已打开的工作台（串行链路里前面的用例可能已开过），没有再新建
        const opened = await page.evaluate(async () => {
            const host = window as unknown as {
                app?: {
                    workspace?: {
                        getLeaf(dir: string): any;
                        getLeavesOfType(type: string): Array<{ view: unknown }>;
                        revealLeaf(leaf: unknown): Promise<void>;
                    };
                };
            };
            const ws = host.app?.workspace;
            if (!ws) return false;
            const existing = ws.getLeavesOfType('novel-writer-full-writer');
            if (existing.length > 0) {
                await ws.revealLeaf(existing[0]);
                return true;
            }
            const leaf = ws.getLeaf('tab');
            await leaf.setViewState({ type: 'novel-writer-full-writer', active: true });
            return true;
        });
        expect(opened).toBe(true);
        await expect.poll(async () => page.evaluate(() => {
            const host = window as unknown as {
                app?: { workspace?: { getLeavesOfType(type: string): unknown[] } };
            };
            return host.app?.workspace?.getLeavesOfType('novel-writer-full-writer').length ?? 0;
        }), { timeout: 20_000 }).toBeGreaterThan(0);

        const result = await page.evaluate(() => {
            const host = window as unknown as {
                app?: { workspace?: { getLeavesOfType(type: string): Array<{ view: unknown }> } };
            };
            const leaves = host.app?.workspace?.getLeavesOfType('novel-writer-full-writer') ?? [];
            // 取最后一个：串行链路里可能是前一个用例留下的旧实例
            const view = leaves[leaves.length - 1]?.view as unknown as {
                tabContent: HTMLElement;
                showChapterRunStrip(orchestrator: unknown, mode: string): void;
                hideChapterRunStrip(): void;
            };
            if (!view?.tabContent) return null;

            const fakeOrchestrator = { isRunning: true, pause() {}, resume() {}, cancel() {} };
            view.showChapterRunStrip(fakeOrchestrator, 'recommended');
            const before = !!document.querySelector('.nw-chapter-run-status');

            // 模拟编排器每一步的 renderInContainer：第一行就是 container.empty()
            view.tabContent.empty();
            const after = !!document.querySelector('.nw-chapter-run-status');
            view.hideChapterRunStrip();
            return { before, after };
        });

        console.log('FW_RUN_STRIP ' + JSON.stringify(result));
        expect(result).not.toBeNull();
        // 旧实现把运行条挂在 tabContent 里的 mainContainer 上，第一步渲染后就消失
        expect(result?.before).toBe(true);
        expect(result?.after).toBe(true);
    });

    test('自定义下拉的文字不被垂直裁切', async () => {
        const { page } = session;

        // 关掉可能遮挡的欢迎弹窗
        for (const candidate of page.context().pages()) {
            await candidate.evaluate(() => {
                document.querySelectorAll<HTMLElement>('.modal-container .modal-close-button')
                    .forEach(el => el.click());
            }).catch(() => undefined);
        }
        await page.waitForTimeout(300);

        expect(await executeCommand(page, SETTINGS_COMMAND)).toBe(true);
        await expect.poll(async () => page.evaluate(() => {
            const host = window as unknown as {
                app?: { setting?: { activeTab?: { containerEl?: HTMLElement } } };
            };
            const root = host.app?.setting?.activeTab?.containerEl;
            if (!root) return false;
            const tab = Array.from(root.querySelectorAll('.nw-settings-tab'))
                .find(el => ((el as HTMLElement).textContent || '').includes('API 配置'));
            (tab as HTMLElement | undefined)?.click();
            return root.querySelectorAll('.nw-api-select').length > 0;
        }), { timeout: 15_000 }).toBe(true);

        const measure = () => page.evaluate(() => {
            const host = window as unknown as {
                app?: { setting?: { activeTab?: { containerEl?: HTMLElement } } };
            };
            const root = host.app?.setting?.activeTab?.containerEl ?? document.body;

            // 只测我们自定义过样式的 select：它们才可能撞上
            // Obsidian 固定的 select height + 自定义上下内边距。
            const custom = Array.from(root.querySelectorAll<HTMLSelectElement>(
                '.nw-select, .nw-api-select, .nw-exec-log-filter, .nw-cowrite-font-select,'
                + ' .novel-writer-fw-title, .novel-writer-fw-chapter-select',
            ));
            return custom.map(el => {
                const cs = getComputedStyle(el);
                const rect = el.getBoundingClientRect();
                const contentBox = rect.height
                    - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom)
                    - (parseFloat(cs.borderTopWidth) || 0) - (parseFloat(cs.borderBottomWidth) || 0);
                const lineHeight = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2;
                return {
                    cls: el.className,
                    // 负数 = 内容盒装不下行高 → 文字被垂直裁切
                    slack: Math.round((contentBox - lineHeight) * 100) / 100,
                    text: el.selectedOptions[0]?.text ?? '',
                };
            });
        });

        const settingsSelects = await measure();
        console.log('SELECT_FIT_SETTINGS ' + JSON.stringify(settingsSelects));
        expect(settingsSelects.length).toBeGreaterThan(0);

        const all = [...settingsSelects];

        // 完整写作工作台里还有两个自定义下拉（项目标题 / 章节选择）
        await page.setViewportSize({ width: 1600, height: 950 }).catch(() => undefined);
        const hasProject = await page.evaluate(() => {
            const host = window as unknown as {
                app?: { vault?: { getAllLoadedFiles?: () => Array<{ path?: string; children?: unknown[] }> } };
            };
            const root = host.app?.vault?.getAllLoadedFiles?.().find(f => f.path === '长篇小说');
            return ((root?.children ?? []) as Array<{ path?: string }>)
                .some(c => typeof c.path === 'string' && c.path.includes('/E2E项目'));
        });
        if (hasProject) {
            await page.evaluate(async () => {
                const host = window as unknown as {
                    app?: {
                        vault?: {
                            getAllLoadedFiles?: () => Array<{ path?: string; children?: unknown[] }>;
                            adapter?: { mkdir?: (p: string) => Promise<void> };
                            create?: (p: string, c: string) => Promise<unknown>;
                            getAbstractFileByPath?: (p: string) => unknown;
                            delete?: (f: unknown) => Promise<void>;
                        };
                        plugins?: { plugins?: Record<string, { openChapterInFullWriter?: (a: string, b: string) => void }> };
                    };
                };
                const vault = host.app?.vault;
                const files = vault?.getAllLoadedFiles?.() ?? [];
                const nl = '长篇小说';
                const rootNode = files.find(f => f.path === nl);
                const projectId = ((rootNode?.children ?? []) as Array<{ path?: string }>)
                    .map(c => c.path).find(p => typeof p === 'string' && p.includes('/E2E项目'));
                if (!projectId) return;
                const bodyPath = projectId + '/03-大纲与章节/正文/第1卷/第1章_正文.md';
                await vault?.adapter?.mkdir?.(bodyPath.split('/').slice(0, -1).join('/')).catch(() => undefined);
                const existing = vault?.getAbstractFileByPath?.(bodyPath);
                if (existing) await vault?.delete?.(existing).catch(() => undefined);
                await vault?.create?.(bodyPath, '---' + String.fromCharCode(10) + 'status: drafting'
                    + String.fromCharCode(10) + '---' + String.fromCharCode(10)).catch(() => undefined);
                host.app?.plugins?.plugins?.['novel-writer-ai']?.openChapterInFullWriter?.(projectId, bodyPath);
            });
            await page.waitForTimeout(1800);

            const fwSelects = await page.evaluate(() => {
                const custom = Array.from(document.querySelectorAll<HTMLSelectElement>(
                    '.novel-writer-fw-title, .novel-writer-fw-chapter-select',
                ));
                return custom.map(el => {
                    const cs = getComputedStyle(el);
                    const rect = el.getBoundingClientRect();
                    const contentBox = rect.height
                        - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom)
                        - (parseFloat(cs.borderTopWidth) || 0) - (parseFloat(cs.borderBottomWidth) || 0);
                    const lineHeight = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2;
                    return {
                        cls: el.className,
                        slack: Math.round((contentBox - lineHeight) * 100) / 100,
                        text: el.selectedOptions[0]?.text ?? '',
                    };
                });
            });
            console.log('SELECT_FIT_FULLWRITER ' + JSON.stringify(fwSelects));
            all.push(...fwSelects);
        }

        // 核心断言：每个自定义下拉的内容盒都必须装得下行高
        for (const item of all) {
            expect(item.slack, item.cls + ' 被垂直裁切（内容盒比行高少 ' + (-item.slack) + 'px）')
                .toBeGreaterThanOrEqual(0);
        }

        await page.evaluate(() => {
            const host = window as unknown as { app?: { setting?: { close?(): void } } };
            host.app?.setting?.close?.();
        });
    });

    test('Agent 工作台可通过多轮对话完成项目创建', async () => {
        const { page, vault } = session;
        const agentProject = `E2E对话${Date.now()}`;
        expect(await executeCommand(page, AGENT_GUIDE_COMMAND)).toBe(true);

        // Agent 工作台是全 leaf 视图（不再是小弹窗）：等叶子出现并渲染对话区
        const workbench = page.locator('.workspace-leaf-content[data-type="novel-writer-agent-workbench"]');
        await expect(workbench).toBeVisible({ timeout: 15_000 });
        await expect(workbench.locator('.nw-awb-messages')).toContainText('对话引导助手', { timeout: 15_000 });

        const say = async (text: string) => {
            await workbench.locator('.nw-awb-input').fill(text);
            await workbench.locator('.nw-awb-send').click();
        };

        await workbench.getByRole('button', { name: /长篇小说/ }).click();
        await expect(workbench.getByRole('button', { name: /🎨 原创/ })).toBeVisible();
        await workbench.getByRole('button', { name: /🎨 原创/ }).click();
        await expect(workbench.getByRole('button', { name: /引导模式/ })).toBeVisible();
        await workbench.getByRole('button', { name: /引导模式/ }).click();
        await expect(workbench.locator('.nw-awb-messages')).toContainText('项目名');

        await say(agentProject);
        await expect(workbench.locator('.nw-awb-messages')).toContainText('频道');
        await workbench.getByRole('button', { name: /男频/ }).click();
        await expect(workbench.locator('.nw-awb-messages')).toContainText('题材');
        await say('玄幻');
        await expect(workbench.locator('.nw-awb-messages')).toContainText('故事结构');
        await workbench.getByRole('button', { name: /起承转合/ }).click();
        await expect(workbench.locator('.nw-awb-messages')).toContainText('叙事基调');
        await workbench.getByRole('button', { name: /跳过（默认）/ }).first().click();
        await expect(workbench.locator('.nw-awb-messages')).toContainText('金手指');
        await workbench.getByRole('button', { name: /跳过（默认）/ }).first().click();
        await expect(workbench.locator('.nw-awb-messages')).toContainText('信息收集完毕');

        await workbench.getByRole('button', { name: /确认创建/ }).click();
        await expect(workbench.locator('.nw-awb-messages')).toContainText('创建完成', { timeout: 60_000 });
        expect(fs.existsSync(path.join(vault.path, '长篇小说', agentProject))).toBe(true);
        expect(fs.existsSync(path.join(vault.path, '长篇小说', agentProject, '00-系统模板', '故事结构指南.md'))).toBe(true);
    });

    test('Agent 工作台：chip 不清输入草稿、Shift+Enter 不发送、控制令牌不上屏', async () => {
        const { page } = session;
        expect(await executeCommand(page, AGENT_GUIDE_COMMAND)).toBe(true);

        const workbench = page.locator('.workspace-leaf-content[data-type="novel-writer-agent-workbench"]');
        await expect(workbench).toBeVisible({ timeout: 15_000 });
        await expect(workbench.locator('.nw-awb-messages')).toContainText('对话引导助手', { timeout: 15_000 });

        const input = workbench.locator('.nw-awb-input');
        // 1) 输入草稿后点 chip：草稿必须保留（旧实现无条件清空）
        await input.fill('未发送的草稿一句');
        await workbench.getByRole('button', { name: /长篇小说/ }).click();
        await expect(input).toHaveValue('未发送的草稿一句');
        await expect(workbench.getByRole('button', { name: /🎨 原创/ })).toBeVisible();

        // 2) Shift+Enter 只换行、不发送（v4.20 起输入框改为 textarea）
        const userBubblesBefore = await workbench.locator('.nw-awb-row-user').count();
        await input.focus();
        await page.keyboard.press('Shift+Enter');
        await expect(input).toHaveValue('未发送的草稿一句\n');
        expect(await workbench.locator('.nw-awb-row-user').count()).toBe(userBubblesBefore);

        // 3) 控制令牌（__retry__ / __fallback_rule__）不得出现在消息气泡里
        const tokenBubbles = await page.evaluate(() => {
            const bubbles = [...document.querySelectorAll('.nw-awb-bubble')];
            return bubbles
                .map(b => (b.textContent || '').trim())
                .filter(text => text === '__retry__' || text === '__fallback_rule__');
        });
        console.log('AGENT_TOKEN_BUBBLES ' + JSON.stringify(tokenBubbles));
        expect(tokenBubbles).toEqual([]);

        // 清理草稿，避免影响后续用例
        await input.fill('');
    });

    test('Agent 工作台自动模式无需逐步输入即可完成创建', async () => {
        const { page, vault } = session;
        expect(await executeCommand(page, AGENT_GUIDE_COMMAND)).toBe(true);

        const workbench = page.locator('.workspace-leaf-content[data-type="novel-writer-agent-workbench"]');
        await expect(workbench).toBeVisible({ timeout: 15_000 });
        // restart() 应重置为全新会话：欢迎语与类型选择 chips 重新出现
        await expect(workbench.locator('.nw-awb-messages')).toContainText('对话引导助手', { timeout: 15_000 });
        await expect(workbench.getByRole('button', { name: /长篇小说/ })).toBeVisible({ timeout: 15_000 });
        await workbench.getByRole('button', { name: /长篇小说/ }).click();
        await workbench.getByRole('button', { name: /🎨 原创/ }).click();
        await workbench.getByRole('button', { name: /自动模式/ }).click();

        await expect(workbench.locator('.nw-awb-messages')).toContainText('自动模式', { timeout: 10_000 });
        await expect(workbench.locator('.nw-awb-messages')).toContainText('创建完成', { timeout: 60_000 });
        const text = await workbench.locator('.nw-awb-messages').innerText();
        const nameMatch = text.match(/projectName = ([^\s·]+)/);
        expect(nameMatch?.[1]).toBeTruthy();
        expect(fs.existsSync(path.join(vault.path, '长篇小说', nameMatch![1]))).toBe(true);
    });

    test('项目列表不把 _versions 识别为项目', async () => {
        const { page } = session;
        // 真实 vault 的 长篇小说/_versions 是章节版本存储；这里复刻同样的目录结构
        await page.evaluate(async () => {
            const app = (window as unknown as { app: any }).app;
            for (const dir of [
                '长篇小说/_versions',
                '长篇小说/_versions/chapter',
                '长篇小说/_versions/chapter/第1章',
                '长篇小说/E2E真实项目',
                '长篇小说/E2E真实项目/03-大纲与章节',
            ]) {
                await app.vault.createFolder(dir).catch(() => undefined);
            }
            const versionPath = '长篇小说/_versions/chapter/第1章/v_e2e.md';
            if (!app.vault.getAbstractFileByPath(versionPath)) {
                await app.vault.create(versionPath, '# 旧版本');
            }
            const markerPath = '长篇小说/E2E真实项目/作品信息.md';
            if (!app.vault.getAbstractFileByPath(markerPath)) {
                await app.vault.create(markerPath, '# 作品信息');
            }
        });

        expect(await executeCommand(page, AGENT_GUIDE_COMMAND)).toBe(true);
        const workbench = page.locator('.workspace-leaf-content[data-type="novel-writer-agent-workbench"]');
        await expect(workbench).toBeVisible({ timeout: 15_000 });
        await expect(workbench.locator('.nw-awb-project-card').first()).toBeVisible({ timeout: 15_000 });

        const cards = await workbench.locator('.nw-awb-project-card').allInnerTexts();
        expect(cards.join(' ')).toContain('E2E真实项目');
        expect(cards.join(' ')).not.toContain('_versions');
    });
});
