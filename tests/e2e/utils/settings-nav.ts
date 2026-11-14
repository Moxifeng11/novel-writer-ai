/**
 * settings-nav.ts — 设置页「一级分组 + 二级 tab」导航helper（v4.96 起）
 *
 * v4.96 把 18 个设置 tab 收敛为 6 个一级分组 + 二级 tab。
 * 旧 spec 直接在主容器里找 `.nw-settings-tab` 会失败（目标 tab 不在当前分组）。
 *
 * 本 helper 的定位策略：
 *  1. 先在当前分组的二级栏里按文案找 tab
 *  2. 找不到则依次点击一级分组（`.nw-settings-group`）再找
 *  3. 仍找不到时展开「高级设置」再找一次（高级 tab 默认折叠）
 */

import type { Page } from '@playwright/test';

/**
 * 切换到指定设置页签。
 *
 * @param page - 承载设置弹窗的窗口页
 * @param label - 页签文案（子串匹配，如「写作规则」）
 * @returns 是否切换成功
 */
export async function switchSettingsTab(page: Page, label: string): Promise<boolean> {
    return page.evaluate(async (name) => {
        const host = window as unknown as {
            app?: { setting?: { activeTab?: { containerEl?: HTMLElement } } };
        };
        const root = host.app?.setting?.activeTab?.containerEl;
        if (!root) return false;

        const findTab = (): HTMLElement | undefined =>
            Array.from(root.querySelectorAll<HTMLElement>('.nw-settings-tab'))
                .find(el => (el.textContent || '').includes(name));
        const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

        let tab = findTab();
        if (!tab) {
            const groups = Array.from(root.querySelectorAll<HTMLElement>('.nw-settings-group'));
            for (const group of groups) {
                group.click();
                await sleep(80);
                tab = findTab();
                if (tab) break;
            }
        }
        if (!tab) {
            // 高级 tab 默认折叠：展开后再找一次
            const toggle = Array.from(root.querySelectorAll<HTMLElement>('.nw-settings-tab'))
                .find(el => (el.textContent || '').includes('高级设置'));
            if (toggle) {
                toggle.click();
                await sleep(80);
                tab = findTab();
            }
        }
        if (!tab) return false;
        tab.click();
        return true;
    }, label);
}

/**
 * 读取设置主容器的文本（用于断言面板内容）。
 *
 * @param page - 承载设置弹窗的窗口页
 * @returns 当前面板文本
 */
export async function settingsPanelText(page: Page): Promise<string> {
    return page.evaluate(() => {
        const host = window as unknown as {
            app?: { setting?: { activeTab?: { containerEl?: HTMLElement } } };
        };
        const root = host.app?.setting?.activeTab?.containerEl;
        return root?.querySelector('.nw-settings-tab-content')?.textContent || '';
    });
}
