#!/usr/bin/env node
/**
 * dev-vault.mjs — 独立开发 vault 的验证工具（DSH-20261117-01）
 *
 * 背景：Obsidian 插件只能从 `<vault>/.obsidian/plugins/<id>` 加载，所以「界面级验证」
 * 必须有一个 vault。为了不污染真实写作 vault（示例项目、E2E 工程、测试书、缓存），
 * 开发期用独立 vault，并把插件目录用 junction/symlink 指回源码仓——构建产物即时生效，
 * 运行期数据（data.json、data/cache.json）落在开发目录（已被 .gitignore 忽略）。
 *
 * 用法：
 *   node scripts/dev-vault.mjs init  [--vault=D:\\nw-dev-vault]
 *   node scripts/dev-vault.mjs verify [--vault=D:\\nw-dev-vault] [--obsidian=<exe>]
 *   node scripts/dev-vault.mjs status [--vault=D:\\nw-dev-vault]
 *
 * verify 会启动一个「独立 user-data-dir」的 Obsidian 实例（不会抢你正在用的窗口），
 * 连上 CDP 检查插件是否真的加载成功，然后退出该实例。
 */
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PLUGIN_ID = 'novel-writer-ai';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const command = argv[0] ?? 'status';
const flag = (name) => {
    const hit = argv.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : undefined;
};

const vaultPath = path.resolve(flag('vault') ?? path.join(os.homedir(), 'nw-dev-vault'));

function defaultObsidian() {
    const candidates = [
        path.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Obsidian', 'Obsidian.exe'),
        path.join(process.env.LOCALAPPDATA ?? '', 'Obsidian', 'Obsidian.exe'),
        path.join(process.env.PROGRAMFILES ?? '', 'Obsidian', 'Obsidian.exe'),
    ];
    return candidates.find((c) => c && fs.existsSync(c));
}

function init() {
    const pluginsDir = path.join(vaultPath, '.obsidian', 'plugins');
    fs.mkdirSync(pluginsDir, { recursive: true });
    const pluginLink = path.join(pluginsDir, PLUGIN_ID);
    if (!fs.existsSync(pluginLink)) {
        fs.symlinkSync(ROOT, pluginLink, 'junction');
        console.log(`✅ 已创建目录联接: ${pluginLink} -> ${ROOT}`);
    } else {
        console.log(`ℹ️ 插件目录已存在: ${pluginLink}`);
    }
    const write = (rel, data) => {
        const file = path.join(vaultPath, '.obsidian', rel);
        if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
    };
    write('app.json', { promptDelete: false });
    write('community-plugins.json', [PLUGIN_ID]);
    write('core-plugins.json', []);
    write('workspace.json', {});
    console.log(`✅ 开发 vault 就绪: ${vaultPath}`);
    console.log('   在 Obsidian 里「打开文件夹作为库」选中它即可（首次需手动打开一次）。');
}

function status() {
    console.log(`vault: ${vaultPath}（${fs.existsSync(vaultPath) ? '存在' : '不存在'}）`);
    if (!fs.existsSync(vaultPath)) return;
    const pluginLink = path.join(vaultPath, '.obsidian', 'plugins', PLUGIN_ID);
    const manifest = path.join(pluginLink, 'manifest.json');
    const linked = fs.existsSync(manifest);
    console.log(`插件目录: ${linked ? '已联接' : '缺失'}`);
    if (linked) {
        const mf = JSON.parse(fs.readFileSync(manifest, 'utf8'));
        console.log(`插件版本: ${mf.version}（${mf.id}）`);
    }
    for (const f of ['main.js', 'styles.css']) {
        const p = path.join(pluginLink, f);
        console.log(`  ${f}: ${fs.existsSync(p) ? Math.round(fs.statSync(p).size / 1024) + ' KB' : '缺失（先运行 npm run build）'}`);
    }
}

const freePort = () =>
    new Promise((resolve, reject) => {
        const server = net.createServer();
        server.unref();
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const port = server.address().port;
            server.close(() => resolve(port));
        });
    });

async function verify() {
    if (!fs.existsSync(path.join(vaultPath, '.obsidian', 'plugins', PLUGIN_ID, 'main.js'))) {
        throw new Error(`插件产物缺失：先运行 npm run build，再执行 init`);
    }
    const exe = flag('obsidian') ?? defaultObsidian();
    if (!exe) throw new Error('找不到 Obsidian.exe，请用 --obsidian=<路径> 指定');

    const { chromium } = await import('@playwright/test');
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'nw-dev-vault-ud-'));
    const vaultId = crypto.randomBytes(8).toString('hex');
    fs.writeFileSync(
        path.join(userData, 'obsidian.json'),
        JSON.stringify({ vaults: { [vaultId]: { path: vaultPath, ts: Date.now(), open: true } }, cli: true, frame: 'custom' }),
    );
    fs.writeFileSync(path.join(userData, vaultId + '.json'), '{}');

    const port = await freePort();
    const child = spawn(exe, [`--user-data-dir=${userData}`, `--remote-debugging-port=${port}`, vaultPath], {
        stdio: 'ignore',
    });
    try {
        let ready = false;
        for (let i = 0; i < 40 && !ready; i++) {
            await new Promise((r) => setTimeout(r, 500));
            try {
                ready = (await fetch(`http://127.0.0.1:${port}/json/version`)).ok;
            } catch {
                /* 端口还没起来，继续等 */
            }
        }
        if (!ready) throw new Error('Obsidian 调试端口未就绪');

        const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
        try {
            let page = null;
            for (let i = 0; i < 30 && !page; i++) {
                const ctx = browser.contexts()[0];
                page = ctx?.pages().find((p) => p.url().includes('index.html')) ?? ctx?.pages()[0] ?? null;
                if (!page) await new Promise((r) => setTimeout(r, 500));
            }
            if (!page) throw new Error('找不到渲染进程页面');

            let result = null;
            for (let i = 0; i < 30; i++) {
                await new Promise((r) => setTimeout(r, 600));
                result = await page.evaluate((id) => {
                    const app = window.app;
                    if (!app) return { appReady: false };
                    const plugin = app.plugins?.plugins?.[id] ?? null;
                    return {
                        appReady: true,
                        vaultName: app.vault?.getName?.() ?? null,
                        enabled: Object.keys(app.plugins?.plugins ?? {}),
                        loaded: !!plugin,
                        version: plugin?.manifest?.version ?? null,
                        commands: Object.keys(app.commands?.commands ?? {}).filter((k) => k.startsWith(id)).length,
                    };
                }, PLUGIN_ID);
                if (result?.loaded) break;
            }
            const ok = !!result?.loaded;
            console.log(JSON.stringify({ ok, ...result }, null, 2));
            if (!ok) process.exitCode = 1;
        } finally {
            await browser.close();
        }
    } finally {
        child.kill();
    }
}

try {
    if (command === 'init') init();
    else if (command === 'verify') await verify();
    else if (command === 'status') status();
    else {
        console.error('用法: node scripts/dev-vault.mjs <init|verify|status> [--vault=<路径>] [--obsidian=<exe>]');
        process.exitCode = 1;
    }
} catch (e) {
    console.error(`❌ ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
}
