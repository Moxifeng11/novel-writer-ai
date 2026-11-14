import { chromium } from 'playwright';
import type { Browser, Page } from 'playwright';
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as net from 'node:net';
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
    page: Page;
    vault: TestVault;
    /** 关闭测试实例并清理由本测试创建的 userData 目录 */
    close: () => Promise<void>;
}

/**
 * OBSIDIAN_PATH 未设置时的默认候选（DSH-20261114 e2e-infra：E2E 常态化）。
 *
 * 优先级：环境变量 > 平台默认安装路径。找到第一个存在的候选即用；
 * 都不存在才整组 skip（行为与旧版一致，只是不再要求每次手工传路径）。
 */
const OBSIDIAN_DEFAULT_CANDIDATES: ReadonlyArray<string> = (() => {
    switch (process.platform) {
        case 'win32':
            return [
                process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Programs', 'obsidian', 'Obsidian.exe') : '',
                'C:\\Program Files\\Obsidian\\Obsidian.exe',
                'C:\\Program Files (x86)\\Obsidian\\Obsidian.exe',
            ].filter(Boolean);
        case 'darwin':
            return ['/Applications/Obsidian.app/Contents/MacOS/Obsidian'];
        case 'linux':
            return ['/usr/bin/obsidian', '/opt/Obsidian/obsidian', '/snap/bin/obsidian'];
        default:
            return [];
    }
})();

/** 读取并校验 OBSIDIAN_PATH；未配置时尝试平台默认安装路径，都没有返回空 */
export function getObsidianExecutable(): string | undefined {
    const candidates = [process.env.OBSIDIAN_PATH?.trim(), ...OBSIDIAN_DEFAULT_CANDIDATES]
        .filter((candidate): candidate is string => Boolean(candidate));
    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) return candidate;
    }
    return undefined;
}

/** E2E 是否具备真实运行条件（仅 OBSIDIAN_PATH 一项） */
export function isObsidianE2EEnabled(): boolean {
    return getObsidianExecutable() !== undefined;
}

/** 未启用时给出可操作的跳过原因 */
export function describeSkipReason(): string {
    const raw = process.env.OBSIDIAN_PATH?.trim();
    if (raw) {
        return `OBSIDIAN_PATH 指向的文件不存在：${raw}`;
    }
    const tried = OBSIDIAN_DEFAULT_CANDIDATES.join('、');
    return `未找到 Obsidian 可执行文件（已尝试默认安装路径：${tried}）。可设置 OBSIDIAN_PATH 指向绝对路径（见 tests/e2e/README.md 与 .env.example）。`;
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
 * 创建临时 vault，默认把构建产物安装为唯一启用的社区插件。
 * `installPlugin: false` 用于性能基线（同版本 Obsidian、无插件）。
 * 不复制 data.json，避免把本机 API Key 带入测试。
 */
export function createTestVault(options: { installPlugin?: boolean } = {}): TestVault {
    const installPlugin = options.installPlugin !== false;
    const root = pluginRoot();
    const vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), 'nw-e2e-vault-'));
    const pluginDir = path.join(vaultPath, '.obsidian', 'plugins', PLUGIN_ID);
    fs.mkdirSync(pluginDir, { recursive: true });

    if (installPlugin) {
        for (const file of ['main.js', 'manifest.json', 'styles.css']) {
            const source = path.join(root, file);
            if (!fs.existsSync(source)) {
                fs.rmSync(vaultPath, { recursive: true, force: true });
                throw new Error(`缺少构建产物 ${file}。请先执行 npm run build 再运行 E2E。`);
            }
            fs.copyFileSync(source, path.join(pluginDir, file));
        }
        copyIfExists(path.join(root, 'workers'), path.join(pluginDir, 'workers'));
    }

    fs.writeFileSync(
        path.join(vaultPath, '.obsidian', 'community-plugins.json'),
        JSON.stringify(installPlugin ? [PLUGIN_ID] : [], null, 2),
    );
    fs.writeFileSync(
        path.join(vaultPath, '.obsidian', 'core-plugins.json'),
        JSON.stringify([]),
    );
    fs.writeFileSync(
        path.join(vaultPath, '.obsidian', 'workspace.json'),
        JSON.stringify({}),
    );
    fs.writeFileSync(
        path.join(vaultPath, '.obsidian', 'app.json'),
        JSON.stringify({ promptDelete: false }, null, 2),
    );

    return { path: vaultPath };
}

async function findFreePort(): Promise<number> {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.unref();
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const address = server.address();
            const port = typeof address === 'object' && address ? address.port : 0;
            server.close(() => (port ? resolve(port) : reject(new Error('无法分配调试端口'))));
        });
    });
}

/**
 * 启动 Obsidian 并返回已就绪的工作区页面。
 *
 * 不使用 Playwright 的 `_electron.launch`：Obsidian 的启动器会让该握手超时。
 * 改用 `--remote-debugging-port` + CDP 连接，并通过独立的 `--user-data-dir`
 * 隔离配置，这样即使用户的 Obsidian 正在运行也不会触发单实例锁。
 */
export async function launchObsidian(vault: TestVault): Promise<ObsidianSession> {
    const executablePath = getObsidianExecutable();
    if (!executablePath) throw new Error('OBSIDIAN_PATH 未配置或无效');

    const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'nw-e2e-userdata-'));
    const vaultId = crypto.randomBytes(8).toString('hex');
    fs.writeFileSync(
        path.join(userDataPath, 'obsidian.json'),
        JSON.stringify({
            vaults: { [vaultId]: { path: vault.path, ts: Date.now(), open: true } },
            cli: true,
            frame: 'custom',
        }),
    );
    fs.writeFileSync(path.join(userDataPath, `${vaultId}.json`), '{}');

    const port = await findFreePort();
    const args = [
        `--user-data-dir=${userDataPath}`,
        `--remote-debugging-port=${port}`,
        vault.path,
    ];
    if (process.platform === 'linux') args.push('--no-sandbox');

    const child: ChildProcess = spawn(executablePath, args, {
        env: { ...process.env, NODE_ENV: 'test' },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr?.on('data', (chunk) => {
        stderr += String(chunk);
    });

    let browser: Browser | null = null;
    try {
        browser = await connectWithRetry(port, child, 60_000);
        const page = await waitForWorkspacePage(browser, 60_000);
        // Electron/CDP 下 Playwright 收不到 <a download> 的 download 事件；
        // 用浏览器级 CDP 把下载直接落到临时 vault 的「导出文件」目录，
        // 这样「成稿导出」E2E 不依赖操作系统下载目录。
        const downloadDir = path.join(vault.path, '导出文件');
        fs.mkdirSync(downloadDir, { recursive: true });
        const cdp = await browser.newBrowserCDPSession();
        await cdp.send('Browser.setDownloadBehavior', {
            behavior: 'allow',
            downloadPath: downloadDir,
            eventsEnabled: true,
        });
        let closed = false;
        const close = async () => {
            if (closed) return;
            closed = true;
            await browser?.close().catch(() => undefined);
            if (child.exitCode === null) {
                child.kill();
                await waitForExit(child, 10_000);
            }
            removeWithRetry(userDataPath);
        };
        return { page, vault, close };
    } catch (e) {
        child.kill();
        await waitForExit(child, 5_000);
        await browser?.close().catch(() => undefined);
        removeWithRetry(userDataPath);
        const detail = stderr.trim() ? `\nObsidian stderr:\n${stderr.trim()}` : '';
        throw new Error(`无法启动 Obsidian 测试实例：${e instanceof Error ? e.message : String(e)}${detail}`);
    }
}

async function connectWithRetry(
    port: number,
    child: ChildProcess,
    timeout: number,
): Promise<Browser> {
    const deadline = Date.now() + timeout;
    let lastError = '';
    while (Date.now() < deadline) {
        if (child.exitCode !== null) {
            throw new Error(`Obsidian 进程提前退出（code=${child.exitCode}）`);
        }
        try {
            return await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
        } catch (e) {
            lastError = e instanceof Error ? e.message : String(e);
            await delay(500);
        }
    }
    throw new Error(`CDP 连接超时（${lastError}）`);
}

async function waitForWorkspacePage(browser: Browser, timeout = 60_000): Promise<Page> {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        for (const context of browser.contexts()) {
            for (const page of context.pages()) {
                try {
                    const ready = await page.evaluate(() => Boolean(document.querySelector('.workspace')));
                    if (ready) return page;
                } catch {
                    // 窗口尚未完成加载，继续等待
                }
            }
        }
        await delay(500);
    }
    throw new Error('未找到 Obsidian 工作区窗口：请确认测试 vault 能被正常打开。');
}

function waitForExit(child: ChildProcess, timeout: number): Promise<void> {
    if (child.exitCode !== null) return Promise.resolve();
    return new Promise((resolve) => {
        const timer = setTimeout(() => {
            child.off('exit', onExit);
            resolve();
        }, timeout);
        const onExit = () => {
            clearTimeout(timer);
            resolve();
        };
        child.once('exit', onExit);
    });
}

function removeWithRetry(target: string): void {
    try {
        fs.rmSync(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
    } catch {
        // Windows 上 Obsidian 退出后仍可能短暂占用缓存文件；测试结束不因此失败
    }
}

/**
 * 首次打开带社区插件的 vault 时，Obsidian 会要求信任作者。
 * 这里只点击可见的信任按钮；不存在时静默跳过。
 */
export async function clickTrustPromptIfPresent(page: Page): Promise<boolean> {
    // 信任弹窗可能被 Obsidian 1.14 渲染到独立的 about:blank 窗口。
    for (const candidatePage of page.context().pages()) {
        const modal = candidatePage
            .locator('.modal-container, .modal')
            .filter({ hasText: /你是否信任这个仓库的作者|Trust the author/i })
            .last();
        if (!(await modal.isVisible().catch(() => false))) continue;

        for (let attempt = 0; attempt < 8; attempt++) {
            const buttons = modal.locator('button');
            const count = await buttons.count();
            let candidate: { index: number; text: string } | null = null;
            for (let i = 0; i < count; i++) {
                const button = buttons.nth(i);
                const text = (await button.textContent().catch(() => '')) ?? '';
                if (/信任|启用社区插件|Trust author|Turn on community plugins/i.test(text)) {
                    candidate = { index: i, text };
                    break;
                }
                // 信任按钮在部分版本里渲染期间文本为空：排除“安全模式”后取最后一个可用按钮。
                if (!/安全模式|safe mode/i.test(text) && !(await button.isDisabled().catch(() => true))) {
                    candidate = { index: i, text };
                }
            }
            if (!candidate) {
                await delay(300);
                continue;
            }
            const target = buttons.nth(candidate.index);
            if (await target.isDisabled().catch(() => true)) {
                await delay(300);
                continue;
            }
            await target.click({ timeout: 5_000 }).catch(() => undefined);
            await delay(1_000);
            return true;
        }
    }
    return false;
}

/**
 * 找到承载 Modal 的窗口。
 * Obsidian 1.14 会把 Modal 渲染到独立的 about:blank 窗口，而不是主工作区页面。
 */
export async function waitForModalPage(anchor: Page, timeout = 10_000): Promise<Page> {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        for (const page of anchor.context().pages()) {
            const count = await page
                .evaluate(() => document.querySelectorAll('.modal-container').length)
                .catch(() => 0);
            if (count > 0) return page;
        }
        await delay(200);
    }
    throw new Error('未找到 Obsidian Modal 窗口：命令可能没有打开弹窗。');
}

/** 等待插件完成 onload；期间自动处理信任弹窗 */export async function waitForPluginLoaded(page: Page, timeout = 60_000): Promise<void> {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        const loaded = await page
            .evaluate((id) => {
                const host = window as unknown as {
                    app?: {
                        plugins?: { plugins?: Record<string, { _loaded?: boolean }> };
                        commands?: { commands?: Record<string, unknown> };
                    };
                };
                const plugin = host.app?.plugins?.plugins?.[id];
                const commands = host.app?.commands?.commands || {};
                const hasCommand = Object.keys(commands).some(key => key.startsWith(`${id}:`));
                // 仅存在插件对象或 _loaded 标记不代表命令已注册：未信任仓库时插件实例可能已创建。
                // 以命令注册为唯一完成信号，确保 waitForPluginLoaded 会持续处理信任弹窗。
                return Boolean(hasCommand && plugin);
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
