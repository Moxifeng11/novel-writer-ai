import { _electron as electron } from 'playwright';
import type { ElectronApplication, Page } from 'playwright';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export const PLUGIN_ID = 'novel-writer-ai';

/** Obsidian 会把插件命令命名为 `<plugin-id>:<command-id>` */
export function toObsidianCommandId(commandId: string): string {
    return `${PLUGIN_ID}:${commandId}`;
}

export interface TestVault {
    /** 临时 vault 的绝对路径 */
    path: string;
}

export interface ObsidianSession {
    app: ElectronApplication;
    page: Page;
    vault: TestVault;
}

/** 读取并校验 OBSIDIAN_PATH；未配置或路径不存在时返回空 */
export function getObsidianExecutable(): string | undefined {
    const executable = process.env.OBSIDIAN_PATH?.trim();
    if (!executable) return undefined;
    if (!fs.existsSync(executable)) return undefined;
    return executable;
}

/** E2E 是否具备真实运行条件（仅 OBSIDIAN_PATH 一项） */
export function isObsidianE2EEnabled(): boolean {
    return getObsidianExecutable() !== undefined;
}

/** 未启用时给出可操作的跳过原因 */
export function describeSkipReason(): string {
    const raw = process.env.OBSIDIAN_PATH?.trim();
    if (!raw) {
        return '未配置 OBSIDIAN_PATH。设置指向 Obsidian 可执行文件的绝对路径后再运行（见 tests/e2e/README.md）。';
    }
    return `OBSIDIAN_PATH 指向的文件不存在：${raw}`;
}

function pluginRoot(): string {
    // tests/e2e/utils -> 插件根目录（三层：utils → e2e → tests → 插件根）
    return path.resolve(__dirname, '..', '..', '..');
}

function copyIfExists(source: string, target: string): void {
    if (!fs.existsSync(source)) return;
    fs.cpSync(source, target, { recursive: true });
}

/**
 * 创建临时 vault，并把构建产物安装为唯一启用的社区插件。
 * 不复制 data.json，避免把本机 API Key 带入测试。
 */
export function createTestVault(): TestVault {
    const root = pluginRoot();
    const vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), 'nw-e2e-vault-'));
    const pluginDir = path.join(vaultPath, '.obsidian', 'plugins', PLUGIN_ID);
    fs.mkdirSync(pluginDir, { recursive: true });

    for (const file of ['main.js', 'manifest.json', 'styles.css']) {
        const source = path.join(root, file);
        if (!fs.existsSync(source)) {
            fs.rmSync(vaultPath, { recursive: true, force: true });
            throw new Error(`缺少构建产物 ${file}。请先执行 npm run build 再运行 E2E。`);
        }
        fs.copyFileSync(source, path.join(pluginDir, file));
    }
    copyIfExists(path.join(root, 'workers'), path.join(pluginDir, 'workers'));

    fs.writeFileSync(
        path.join(vaultPath, '.obsidian', 'community-plugins.json'),
        JSON.stringify([PLUGIN_ID], null, 2),
    );
    fs.writeFileSync(
        path.join(vaultPath, '.obsidian', 'app.json'),
        JSON.stringify({ promptDelete: false }, null, 2),
    );

    return { path: vaultPath };
}

/** 启动 Obsidian 并返回已就绪的工作区页面 */
export async function launchObsidian(vault: TestVault): Promise<ObsidianSession> {
    const executablePath = getObsidianExecutable();
    if (!executablePath) throw new Error('OBSIDIAN_PATH 未配置或无效');

    const args = [vault.path];
    if (process.platform === 'linux') args.push('--no-sandbox');

    const app = await electron.launch({
        executablePath,
        args,
        env: { ...process.env, NODE_ENV: 'test' },
        timeout: 120_000,
    });

    const page = await waitForWorkspacePage(app);
    return { app, page, vault };
}

async function waitForWorkspacePage(app: ElectronApplication, timeout = 60_000): Promise<Page> {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        for (const page of app.windows()) {
            try {
                const ready = await page.evaluate(() => Boolean(document.querySelector('.workspace')));
                if (ready) return page;
            } catch {
                // 窗口尚未完成加载，继续等待
            }
        }
        await delay(500);
    }
    throw new Error('未找到 Obsidian 工作区窗口：请确认 OBSIDIAN_PATH 有效，且启动时没有阻塞式弹窗。');
}

/**
 * 首次打开带社区插件的 vault 时，Obsidian 会要求信任作者。
 * 这里只点击可见的信任按钮；不存在时静默跳过。
 */
export async function clickTrustPromptIfPresent(page: Page): Promise<boolean> {
    const modal = page.locator('.modal-container').last();
    if (!(await modal.isVisible().catch(() => false))) return false;

    const buttons = modal.locator('button');
    const count = await buttons.count();
    for (let i = 0; i < count; i++) {
        const button = buttons.nth(i);
        const text = (await button.textContent().catch(() => '')) ?? '';
        if (/信任|启用社区插件|Trust author|Turn on community plugins/i.test(text)) {
            await button.click();
            return true;
        }
    }
    return false;
}

/** 等待插件完成 onload；期间自动处理信任弹窗 */
export async function waitForPluginLoaded(page: Page, timeout = 60_000): Promise<void> {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        const loaded = await page
            .evaluate((id) => {
                const host = window as unknown as {
                    app?: { plugins?: { plugins?: Record<string, unknown> } };
                };
                return Boolean(host.app?.plugins?.plugins?.[id]);
            }, PLUGIN_ID)
            .catch(() => false);
        if (loaded) return;

        await clickTrustPromptIfPresent(page);
        await delay(500);
    }
    throw new Error(`插件 ${PLUGIN_ID} 未被 Obsidian 加载：请确认构建产物完整且 vault 已信任该插件。`);
}

/** 通过 Obsidian 命令系统触发命令，返回命令是否存在 */
export async function executeCommand(page: Page, commandId: string): Promise<boolean> {
    return page.evaluate((id) => {
        const host = window as unknown as {
            app?: { commands?: { executeCommandById?: (command: string) => boolean } };
        };
        return Boolean(host.app?.commands?.executeCommandById?.(id));
    }, commandId);
}

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
