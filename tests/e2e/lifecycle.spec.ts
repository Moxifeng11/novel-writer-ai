/**
 * 插件生命周期 E2E：启用 → 禁用 → 重新启用 → 卸载（插件目录移除后重启）。
 *
 * 使用独立临时 vault 与 userData，不触碰真实 vault。
 * 需 OBSIDIAN_PATH；未配置时整组跳过。
 */
import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
    createTestVault,
    describeSkipReason,
    isObsidianE2EEnabled,
    launchObsidian,
    waitForPluginLoaded,
    type ObsidianSession,
} from './utils/obsidian-app';

const PLUGIN_ID = 'novel-writer-ai';
const COMMAND_ID = `${PLUGIN_ID}:novel-writer-create-project`;

test.describe('Novel Writer AI · 生命周期', () => {
    test.skip(!isObsidianE2EEnabled(), describeSkipReason());

    test('启用/禁用/重启用后命令与样式正确回收', async () => {
        const vault = createTestVault();
        const session = await launchObsidian(vault);
        try {
            const { page } = session;
            await waitForPluginLoaded(page);
            await page.waitForTimeout(1_500);

            const state = await page.evaluate(({ pluginId, commandId }) => {
                const app = (window as unknown as { app: any }).app;
                return {
                    loaded: Boolean(app.plugins?.plugins?.[pluginId]),
                    command: Boolean(app.commands?.commands?.[commandId]),
                    injectedStyles: document.querySelectorAll('style[id^="novel-writer-"]').length,
                };
            }, { pluginId: PLUGIN_ID, commandId: COMMAND_ID });
            expect(state.loaded).toBe(true);
            expect(state.command).toBe(true);
            // v4.80.0：运行时 <style> 注入已清零，样式走打包 styles.css；这里断言不再注入
            expect(state.injectedStyles).toBe(0);

            await page.evaluate(async (pluginId) => {
                const app = (window as unknown as { app: any }).app;
                await app.plugins.disablePlugin(pluginId);
            }, PLUGIN_ID);
            await page.waitForTimeout(1_000);

            const disabled = await page.evaluate(({ pluginId, commandId }) => {
                const app = (window as unknown as { app: any }).app;
                return {
                    loaded: Boolean(app.plugins?.plugins?.[pluginId]),
                    command: Boolean(app.commands?.commands?.[commandId]),
                    injectedStyles: document.querySelectorAll('style[id^="novel-writer-"]').length,
                };
            }, { pluginId: PLUGIN_ID, commandId: COMMAND_ID });
            expect(disabled.loaded).toBe(false);
            expect(disabled.command).toBe(false);
            expect(disabled.injectedStyles).toBe(0);

            // 重复 3 轮：禁用/启用必须幂等，样式与命令不能跨轮残留
            for (let cycle = 0; cycle < 3; cycle += 1) {
                await page.evaluate(async (pluginId) => {
                    const app = (window as unknown as { app: any }).app;
                    await app.plugins.disablePlugin(pluginId);
                }, PLUGIN_ID);
                await page.waitForTimeout(500);

                const disabled = await page.evaluate(({ pluginId, commandId }) => {
                    const app = (window as unknown as { app: any }).app;
                    return {
                        loaded: Boolean(app.plugins?.plugins?.[pluginId]),
                        command: Boolean(app.commands?.commands?.[commandId]),
                        injectedStyles: document.querySelectorAll('style[id^="novel-writer-"]').length,
                    };
                }, { pluginId: PLUGIN_ID, commandId: COMMAND_ID });
                expect(disabled.loaded).toBe(false);
                expect(disabled.command).toBe(false);
                expect(disabled.injectedStyles).toBe(0);

                await page.evaluate(async (pluginId) => {
                    const app = (window as unknown as { app: any }).app;
                    await app.plugins.enablePlugin(pluginId);
                }, PLUGIN_ID);
                await waitForPluginLoaded(page);

                const reenabled = await page.evaluate(({ pluginId, commandId }) => {
                    const app = (window as unknown as { app: any }).app;
                    return {
                        loaded: Boolean(app.plugins?.plugins?.[pluginId]),
                        command: Boolean(app.commands?.commands?.[commandId]),
                        injectedStyles: document.querySelectorAll('style[id^="novel-writer-"]').length,
                    };
                }, { pluginId: PLUGIN_ID, commandId: COMMAND_ID });
                expect(reenabled.loaded).toBe(true);
                expect(reenabled.command).toBe(true);
                expect(reenabled.injectedStyles).toBe(0);
            }
        } finally {
            await session.close().catch(() => undefined);
            fs.rmSync(vault.path, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
        }
    });

    test('移除插件目录后重启：Obsidian 仍可打开且插件不加载', async () => {
        const vault = createTestVault();
        const first = await launchObsidian(vault);
        await waitForPluginLoaded(first.page);
        await first.page.evaluate(async (pluginId) => {
            const app = (window as unknown as { app: any }).app;
            await app.plugins.disablePlugin(pluginId);
        }, PLUGIN_ID);
        await first.close();

        // 模拟卸载：插件目录被移除，但社区插件清单仍留有历史记录
        fs.rmSync(path.join(vault.path, '.obsidian', 'plugins', PLUGIN_ID), {
            recursive: true,
            force: true,
            maxRetries: 5,
            retryDelay: 300,
        });

        const second = await launchObsidian(vault);
        try {
            const loaded = await second.page.evaluate((pluginId) => {
                const app = (window as unknown as { app: any }).app;
                return Boolean(app.plugins?.plugins?.[pluginId]);
            }, PLUGIN_ID);
            expect(loaded).toBe(false);
        } finally {
            await second.close().catch(() => undefined);
            fs.rmSync(vault.path, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
        }
    });
});
