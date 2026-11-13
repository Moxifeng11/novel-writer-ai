/**
 * settings-regroup.spec.ts — 设置 6 分组一级 tab 真实渲染（settings-tab-regroup-fix）
 *
 * 缺陷：31bda235 重构后 renderBars 只挂在 click 回调里，初次 display() 时
 * groupBar/tabBar 是空 div——真实 Obsidian 里设置页只见「📖 设置 → 空块 → 模型设置」。
 * 修复后：初屏即渲染 6 个一级分组 pill + 当前组二级 tab。
 *
 * 关键环境事实（utils.waitForModalPage 注释）：Obsidian 1.14 把 Modal 渲染到
 * 独立 about:blank 窗口——设置弹窗也在独立 page 里，主页面 querySelector 永远为空
 * （此前 dsh CLI 取证与首版 spec 假阴性均源于此）。必须 waitForModalPage 拿到
 * 承载窗口，再按用户路径点击左侧导航进入插件 tab，在 modal page 断言 DOM。
 * 需 OBSIDIAN_PATH；未配置时整组跳过（与既有 E2E 口径一致）。
 */
import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';
import {
    createTestVault,
    describeSkipReason,
    isObsidianE2EEnabled,
    launchObsidian,
    waitForPluginLoaded,
} from './utils/obsidian-app';
import type { Page } from '@playwright/test';

const PLUGIN_ID = 'novel-writer-ai';
/** 设置弹窗左侧导航显示的是 manifest 英文名（中文描述不进导航） */
const PLUGIN_NAV_TEXT = 'Novel Writer AI';
const EXPECTED_GROUPS = ['🔌 连接与模型', '✍️ 写作与协同', '📜 规则与一致性', '📚 知识与拆解', '🎨 界面与工作台', '🗂 项目与运维'];

/**
 * 找到承载「设置弹窗」的窗口页。
 * 与 waitForModalPage 的区别：首启会有欢迎弹窗（.modal-container 同样存在），
 * 设置弹窗的独有签名是左侧导航 .vertical-tab-nav-item。
 */
async function waitForSettingsPage(anchor: Page, timeout = 15_000): Promise<Page> {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        for (const candidate of anchor.context().pages()) {
            const hit = await candidate.evaluate(() => document.querySelectorAll('.vertical-tab-nav-item').length > 0)
                .catch(() => false);
            if (hit) return candidate;
        }
        await new Promise(resolve => setTimeout(resolve, 200));
    }
    throw new Error('未找到 Obsidian 设置弹窗窗口（.vertical-tab-nav-item）。');
}

/** 在 modal page 上收集插件设置外壳的当前状态 */
async function readShell(modalPage: Page): Promise<{
    pills: number;
    labels: string[];
    activeGroup: string | null;
    tabIds: string[];
}> {
    return modalPage.evaluate(() => {
        const groups = [...document.querySelectorAll('.nw-settings-group')];
        return {
            pills: groups.length,
            labels: groups.map(el => (el as HTMLElement).textContent?.trim() ?? ''),
            activeGroup: groups.find(el => el.classList.contains('active'))?.getAttribute('data-group-id') ?? null,
            tabIds: [...document.querySelectorAll('.nw-settings-tab[data-tab-id]')]
                .map(el => el.getAttribute('data-tab-id'))
                .filter((id): id is string => id !== null),
        };
    });
}

test.describe('Novel Writer AI · 设置 6 分组一级 tab', () => {
    test.skip(!isObsidianE2EEnabled(), describeSkipReason());

    test('初屏渲染 6 个一级分组 pill，点击分组与高级折叠真实生效', async () => {
        const vault = createTestVault();
        const session = await launchObsidian(vault);
        let evidenceSaved = false;
        try {
            const { page } = session;
            await waitForPluginLoaded(page);
            await page.waitForTimeout(2_000);

            // 首启会有欢迎弹窗（可能与设置弹窗同窗叠加、也可能独立成窗）。
            // 用户路径：点欢迎弹窗的「⚙️ 打开设置」——既关弹窗又进设置页。
            for (const candidate of page.context().pages()) {
                const hasWelcome = await candidate.evaluate(() => Boolean(document.querySelector('.nw-modal')))
                    .catch(() => false);
                if (!hasWelcome) continue;
                const settingsBtn = candidate.locator('button', { hasText: '打开设置' }).first();
                if (await settingsBtn.count() > 0) {
                    await settingsBtn.click({ timeout: 5_000 }).catch(() => undefined);
                } else {
                    await candidate.keyboard.press('Escape').catch(() => undefined);
                }
                await candidate.waitForSelector('.nw-modal', { state: 'detached', timeout: 5_000 }).catch(() => undefined);
            }

            // 确保设置弹窗已打开（若欢迎流程未顺带打开，从主页面再开一次）
            const alreadyOpen = await page.context().pages().some(p => p.evaluate(
                () => document.querySelectorAll('.vertical-tab-nav-item').length > 0,
            ).catch(() => false));
            if (!alreadyOpen) {
                await page.evaluate(() => (window as unknown as { app: any }).app.setting.open());
            }
            const modalPage = await waitForSettingsPage(page, 15_000);

            // 用户路径：点击左侧导航里的插件 tab（manifest 名 "Novel Writer AI"）
            const navItem = modalPage.locator('.vertical-tab-nav-item', { hasText: PLUGIN_NAV_TEXT }).first();
            await expect(navItem).toBeVisible({ timeout: 10_000 });
            await navItem.click();
            await expect(modalPage.locator('.nw-settings-groupbar')).toBeVisible({ timeout: 10_000 });

            // ① 初屏：6 个一级分组 pill 在设置弹窗 DOM 里（修复前此处为 0 —— 缺陷本体）
            const initial = await readShell(modalPage);
            expect(initial.pills, '初屏必须有 6 个一级分组 pill（修复前为 0）').toBe(6);
            expect(initial.labels).toEqual(EXPECTED_GROUPS);
            expect(initial.activeGroup).toBe('connect');
            // 高级默认折叠：connect 组只有 api
            expect(initial.tabIds).toEqual(['api']);

            // ② 点击「✍️ 写作与协同」pill：二级 tab 切到 cowrite/writing（真实 click 事件）
            await modalPage.locator('.nw-settings-group[data-group-id="writing"]').click();
            await expect(modalPage.locator('.nw-settings-tab[data-tab-id="cowrite"]')).toBeVisible({ timeout: 5_000 });
            const afterGroupClick = await readShell(modalPage);
            expect(afterGroupClick.activeGroup).toBe('writing');
            expect(afterGroupClick.tabIds).toEqual(['cowrite', 'writing']);
            expect(modalPage.locator('.nw-settings-group[data-group-id="writing"].active')).toHaveCount(1);
            expect(modalPage.locator('.nw-settings-group[data-group-id="connect"].active')).toHaveCount(0);

            // ③ 点「⚙ 高级设置」：advanced tab（modes/suggestions）出现并持久化
            await modalPage.locator('.nw-settings-tab-advanced-toggle').click();
            await expect(modalPage.locator('.nw-settings-tab[data-tab-id="modes"]')).toBeVisible({ timeout: 5_000 });
            const afterAdvanced = await readShell(modalPage);
            expect(afterAdvanced.tabIds).toEqual(['cowrite', 'writing', 'modes', 'suggestions']);
            // saveSettings 在主窗口上下文执行——回主页面验证持久化
            await expect.poll(async () => page.evaluate((id) => Boolean(
                (window as unknown as { app: any }).app.plugins.plugins[id]?.settings.settingsUiShowAdvanced,
            ), PLUGIN_ID), { timeout: 5_000 }).toBe(true);

            // 再点一次收起：advanced tab 退场
            await modalPage.locator('.nw-settings-tab-advanced-toggle').click();
            await expect(modalPage.locator('.nw-settings-tab[data-tab-id="modes"]')).toHaveCount(0, { timeout: 5_000 });
            expect((await readShell(modalPage)).tabIds).toEqual(['cowrite', 'writing']);

            // 证据截图（任务 accept：截图 / dev:console 证据）
            await page.waitForTimeout(300);
            await modalPage.screenshot({ path: 'docs/audits/settings-regroup-evidence.png', fullPage: false });
            evidenceSaved = true;
        } finally {
            await session.close().catch(() => undefined);
            fs.rmSync(vault.path, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
            if (!evidenceSaved) {
                // 失败现场不留半截截图
                fs.rmSync('docs/audits/settings-regroup-evidence.png', { force: true });
            }
        }
    });
});
