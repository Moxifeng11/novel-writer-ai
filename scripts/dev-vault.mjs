#!/usr/bin/env node
/**
 * dev-vault.mjs — 独立开发 vault 管理（E-补：运行期数据解耦）
 *
 * 背景：Obsidian 只能从 `<vault>/.obsidian/plugins/<id>` 加载插件；而写作 vault 的插件目录
 * 就是本仓。早先开发 vault 用 junction 指回本仓，等于两个 vault 共用同一份插件目录，
 * 于是 data.json、data/、.sessions 全被共用——造样本书会写真实设置，测试残留也会污染写作侧。
 *
 * 现在改成：vault 里的插件目录是**真实目录**，只从本仓同步构建产物
 * （manifest.json / main.js / styles.css / workers/），运行期数据（data.json、data/、
 * .sessions、pet-image.*）归开发 vault 自己所有。
 *
 * 命令：
 *   node scripts/dev-vault.mjs init    [--vault=D:\nw-dev-vault]
 *   node scripts/dev-vault.mjs sync    [--vault=...]   # npm run build 之后同步产物
 *   node scripts/dev-vault.mjs status  [--vault=...]
 *   node scripts/dev-vault.mjs verify  [--vault=...] [--obsidian=<exe>]
 *   node scripts/dev-vault.mjs reset-data --yes [--vault=...]
 *
 * 注意：init 迁移 junction 时只删除联接本身，不会碰本仓任何文件（删除前校验目标路径）。
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
const hasFlag = (name) => argv.some((a) => a === `--${name}` || a.startsWith(`--${name}=`));

const vaultPath = path.resolve(flag('vault') ?? path.join(os.homedir(), 'nw-dev-vault'));
const obsidianConfigDir = '.obsidian';
const pluginsDir = path.join(vaultPath, obsidianConfigDir, 'plugins');
const pluginDir = path.join(pluginsDir, PLUGIN_ID);
const MARKER = '.nw-dev-vault.json';

/** 构建产物：单向同步 仓 → 开发 vault */
const ARTIFACT_FILES = ['manifest.json', 'main.js', 'styles.css', 'styles.css.map', 'versions.json'];
const ARTIFACT_DIRS = ['workers'];
/** 运行期数据：开发 vault 私有，永不同步、永不读仓内版本 */
const RUNTIME_FILES = ['data.json', 'data.json.bak', 'pet-image.png', 'pet-image.json'];
const RUNTIME_DIRS = ['data', '.sessions'];

function defaultObsidian() {
    const candidates = [
        path.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Obsidian', 'Obsidian.exe'),
        path.join(process.env.LOCALAPPDATA ?? '', 'Obsidian', 'Obsidian.exe'),
        path.join(process.env.PROGRAMFILES ?? '', 'Obsidian', 'Obsidian.exe'),
    ];
    return candidates.find((c) => c && fs.existsSync(c));
}

function dirKind(p) {
    let st;
    try {
        st = fs.lstatSync(p);
    } catch {
        return 'missing';
    }
    if (st.isSymbolicLink()) return 'link';
    return st.isDirectory() ? 'dir' : 'other';
}

function isLinkOnly(p) {
    try {
        return fs.lstatSync(p).isSymbolicLink();
    } catch {
        return false;
    }
}

/** 删除 junction/symlink 本身：先校验指向本仓，避免误删真实目录。 */
function removeLink(p) {
    if (!isLinkOnly(p)) throw new Error(`${p} 不是联接，拒绝删除`);
    const target = fs.realpathSync(p);
    if (path.resolve(target) !== path.resolve(ROOT)) {
        throw new Error(`联接指向 ${target}，不是本仓，拒绝删除`);
    }
    try {
        fs.unlinkSync(p);
    } catch {
        fs.rmdirSync(p);
    }
    if (!fs.existsSync(path.join(ROOT, 'manifest.json'))) {
        throw new Error('删除联接后仓内 manifest.json 消失，已中止后续步骤');
    }
}

function ensureNotInsideRepo() {
    const rel = path.relative(ROOT, vaultPath);
    if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) {
        throw new Error(`开发 vault 不能放在插件仓内: ${vaultPath}`);
    }
}

function copyIfChanged(src, dst) {
    const a = fs.statSync(src);
    if (fs.existsSync(dst)) {
        const b = fs.statSync(dst);
        if (b.size === a.size && Math.abs(b.mtimeMs - a.mtimeMs) < 1) return false;
    }
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
    return true;
}

function syncArtifacts({ quiet = false } = {}) {
    let copied = 0;
    let skipped = 0;
    if (!fs.existsSync(path.join(ROOT, 'main.js'))) {
        throw new Error('仓内缺少 main.js：先运行 npm run build 再执行 sync/init');
    }
    for (const f of ARTIFACT_FILES) {
        const src = path.join(ROOT, f);
        if (!fs.existsSync(src)) continue;
        if (copyIfChanged(src, path.join(pluginDir, f))) copied++;
        else skipped++;
    }
    for (const d of ARTIFACT_DIRS) {
        const srcDir = path.join(ROOT, d);
        if (!fs.existsSync(srcDir)) continue;
        const walk = (dir) => {
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                const full = path.join(dir, entry.name);
                if (entry.isDirectory()) walk(full);
                else if (entry.isFile()) {
                    const rel = path.relative(ROOT, full);
                    if (copyIfChanged(full, path.join(pluginDir, rel))) copied++;
                    else skipped++;
                }
            }
        };
        walk(srcDir);
    }
    if (!quiet) console.log(`✅ 产物同步完成：更新 ${copied} 个文件，未变 ${skipped} 个`);
    return { copied, skipped };
}

function seedData() {
    const dataFile = path.join(pluginDir, 'data.json');
    if (fs.existsSync(dataFile)) return false;
    const example = path.join(ROOT, 'data.example.json');
    fs.writeFileSync(dataFile, fs.existsSync(example) ? fs.readFileSync(example) : '{}\n');
    return true;
}

function writeMarker() {
    const file = path.join(pluginDir, MARKER);
    if (fs.existsSync(file)) return;
    fs.writeFileSync(
        file,
        JSON.stringify({ owner: 'nw-dev-vault', sourceRepo: ROOT, createdAt: new Date().toISOString() }, null, 2) + '\n',
    );
}

/** Obsidian 首次打开 vault 需要的四个配置文件，只在缺失时写。 */
function seedObsidianConfig() {
    const write = (rel, data) => {
        const file = path.join(vaultPath, obsidianConfigDir, rel);
        if (fs.existsSync(file)) return;
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
    };
    write('app.json', { promptDelete: false });
    write('community-plugins.json', [PLUGIN_ID]);
    write('core-plugins.json', []);
    write('workspace.json', {});
}

function init() {
    ensureNotInsideRepo();
    fs.mkdirSync(pluginsDir, { recursive: true });
    const kind = dirKind(pluginDir);
    if (kind === 'link') {
        const target = fs.realpathSync(pluginDir);
        console.log(`⚠️  插件目录是联接（-> ${target}），与写作 vault 共用运行数据，开始迁移…`);
        removeLink(pluginDir);
        console.log('   已移除联接（仓内文件未受影响）');
    } else if (kind === 'missing') {
        console.log('ℹ️  插件目录不存在，新建真实目录');
    } else {
        console.log('ℹ️  插件目录已是真实目录');
    }
    fs.mkdirSync(pluginDir, { recursive: true });
    syncArtifacts();
    if (seedData()) console.log('✅ 已生成开发 vault 专属 data.json（来自 data.example.json）');
    writeMarker();
    seedObsidianConfig();
    console.log(`✅ 开发 vault 就绪: ${vaultPath}`);
    console.log('   在 Obsidian 里「打开文件夹作为库」选中它即可；改代码后跑 npm run build && node scripts/dev-vault.mjs sync');
}

function status() {
    const exists = fs.existsSync(vaultPath);
    console.log(`vault: ${vaultPath}（${exists ? '存在' : '不存在'}）`);
    if (!exists) return;
    const kind = dirKind(pluginDir);
    const kindText = { dir: '真实目录（运行数据独立）', link: '联接（⚠️ 与仓共用运行数据）', missing: '缺失', other: '非目录' }[kind];
    console.log(`插件目录: ${kindText}`);
    if (kind === 'link') console.log(`  指向: ${fs.realpathSync(pluginDir)}`);

    console.log('产物:');
    for (const f of [...ARTIFACT_FILES, ...ARTIFACT_DIRS.map((d) => d + '/')]) {
        const dst = path.join(pluginDir, f);
        const src = path.join(ROOT, f);
        if (!fs.existsSync(dst)) {
            console.log(`  ${f.padEnd(16)} 缺失`);
            continue;
        }
        const a = fs.statSync(dst);
        let stale = '';
        if (fs.existsSync(src)) {
            const b = fs.statSync(src);
            if (b.mtimeMs > a.mtimeMs + 1) stale = '  ⚠️ 仓内更新，需 sync';
        }
        const size = f.endsWith('/') ? '' : Math.round(a.size / 1024) + ' KB';
        console.log(`  ${f.padEnd(16)} ${size.padEnd(9)} ${a.mtime.toISOString().slice(5, 16)}${stale}`);
    }

    console.log('运行数据（开发 vault 私有）:');
    for (const f of RUNTIME_FILES) {
        const p = path.join(pluginDir, f);
        console.log(`  ${f.padEnd(16)} ${fs.existsSync(p) ? Math.round(fs.statSync(p).size / 1024) + ' KB' : '无'}`);
    }
    for (const d of RUNTIME_DIRS) {
        const p = path.join(pluginDir, d);
        if (!fs.existsSync(p)) {
            console.log(`  ${d + '/'.padEnd(15)} 无`);
            continue;
        }
        const n = fs.readdirSync(p).length;
        console.log(`  ${d + '/'.padEnd(15)} ${n} 项`);
    }
    const marker = path.join(pluginDir, MARKER);
    console.log(`归属标记: ${fs.existsSync(marker) ? '已标记为开发 vault' : '无（旧版 junction 残留或手工目录）'}`);
    if (kind === 'dir') {
        const repoData = path.join(ROOT, 'data.json');
        const devData = path.join(pluginDir, 'data.json');
        if (fs.existsSync(repoData) && fs.existsSync(devData)) {
            const same = fs.statSync(repoData).size === fs.statSync(devData).size && fs.readFileSync(repoData).equals(fs.readFileSync(devData));
            console.log(`与写作 vault 的 data.json: ${same ? '内容相同（若是刚刚拷贝的初始值可忽略）' : '已分离'}`);
        }
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
    if (!fs.existsSync(path.join(pluginDir, 'main.js'))) {
        throw new Error('插件产物缺失：先运行 npm run build && node scripts/dev-vault.mjs sync');
    }
    if (dirKind(pluginDir) !== 'dir') {
        throw new Error('插件目录不是真实目录：先运行 node scripts/dev-vault.mjs init 做迁移');
    }
    if (!fs.existsSync(path.join(pluginDir, 'data.json'))) {
        throw new Error('缺少开发 vault 专属 data.json：先运行 init');
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

            // 独立 --user-data-dir 是全新配置，Obsidian 首次打开该 vault 会弹「是否信任仓库作者」；
            // 不点「信任仓库作者并启用插件」插件根本不会加载（verify 会假报 loaded:false）。
            let trusted = false;
            for (let i = 0; i < 20; i++) {
                trusted = await page.evaluate(() => {
                    const btn = Array.from(document.querySelectorAll('.modal button'))
                        .find((b) => (b.textContent || '').includes('信任仓库作者'));
                    if (!btn) return false;
                    btn.click();
                    return true;
                });
                if (trusted) break;
                await new Promise((r) => setTimeout(r, 500));
            }
            if (trusted) console.log('[dev-vault] 已点击「信任仓库作者并启用插件」');

            let result = null;
            for (let i = 0; i < 40; i++) {
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
                // 命令在 onload 之后才注册，等它非零才算真正就绪（否则会误报 commands: 0）
                if (result?.loaded && result.commands > 0) break;
            }
            const ok = !!result?.loaded;
            const expectedVault = path.basename(vaultPath);
            console.log(JSON.stringify({ ok, expectedVault, dataOwned: true, ...result }, null, 2));
            if (!ok) process.exitCode = 1;
        } finally {
            await browser.close();
        }
    } finally {
        child.kill();
    }
}

function resetData() {
    if (!hasFlag('yes')) throw new Error('reset-data 会删除开发 vault 的 data.json/data/.sessions，确认请加 --yes');
    if (dirKind(pluginDir) !== 'dir') throw new Error('插件目录不是真实目录，拒绝清理');
    let removed = 0;
    for (const f of RUNTIME_FILES) {
        const p = path.join(pluginDir, f);
        if (fs.existsSync(p)) {
            fs.rmSync(p, { force: true });
            removed++;
        }
    }
    for (const d of RUNTIME_DIRS) {
        const p = path.join(pluginDir, d);
        if (fs.existsSync(p)) {
            fs.rmSync(p, { recursive: true, force: true });
            removed++;
        }
    }
    seedData();
    console.log(`✅ 已清理 ${removed} 项运行数据，并重建空白 data.json`);
}

try {
    if (command === 'init') init();
    else if (command === 'sync') syncArtifacts();
    else if (command === 'verify') await verify();
    else if (command === 'status') status();
    else if (command === 'reset-data') resetData();
    else {
        console.error('用法: node scripts/dev-vault.mjs <init|sync|status|verify|reset-data> [--vault=<路径>] [--obsidian=<exe>]');
        process.exitCode = 1;
    }
} catch (e) {
    console.error(`❌ ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
}
