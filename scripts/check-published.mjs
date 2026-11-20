#!/usr/bin/env node
/**
 * check-published.mjs —— 社区目录上架状态自查
 *
 * 判定「上架成功」必须同时满足（缺一不可）：
 *   1. 公开插件页的 Current version == 我们的版本（目录侧只显示通过审核的版本）
 *   2. 客户端市场清单 community-plugins.json 里存在本插件 id
 *   3. RSS feed 出现该版本条目
 *
 * 用法：
 *   node scripts/check-published.mjs                 # 只报告状态，永远 exit 0
 *   node scripts/check-published.mjs --expect 4.97.3 # 未达标则 exit 1（可用于轮询/CI）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(fs.readFileSync(path.join(rootDir, 'manifest.json'), 'utf8'));
const pluginId = manifest.id;
const version = manifest.version;

const argv = process.argv.slice(2);
const expectIndex = argv.indexOf('--expect');
const expectVersion = expectIndex >= 0 ? argv[expectIndex + 1] : null;

const SITE_URL = `https://community.obsidian.md/plugins/${pluginId}`;
const LIST_URL = 'https://raw.githubusercontent.com/obsidianmd/obsidian-releases/master/community-plugins.json';
const FEED_URL = `https://community.obsidian.md/plugins/${pluginId}/feed.xml`;

async function getText(url, attempts = 3) {
    let lastError = null;
    for (let i = 0; i < attempts; i++) {
        try {
            // community-plugins.json 有 3MB+，弱网下默认超时容易中途断开（terminated），这里放宽并重试
            const res = await fetch(url, {
                headers: { 'user-agent': 'novel-writer-ai-release-check' },
                signal: AbortSignal.timeout(60_000),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
            return await res.text();
        } catch (e) {
            lastError = e;
            if (i < attempts - 1) await new Promise((resolve) => setTimeout(resolve, 1500 * (i + 1)));
        }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

const facts = {
    siteVersion: null,
    lastUpdatedTitle: null,
    lastUpdatedRelative: null,
    downloads: null,
    siteEntries: [],
    inMarketList: null,
    feedVersions: [],
    errors: [],
};

try {
    const html = await getText(SITE_URL);
    const versionMatch = html.match(/Current version<\/div><div[^>]*>([^<]+)</);
    if (versionMatch) facts.siteVersion = versionMatch[1].trim();
    // 「目录上次检查时间」决定该等周期检查还是去点 Check for new releases
    const updatedMatch = html.match(/Last updated<\/div><div title="([^"]*)">([^<]*)</);
    if (updatedMatch) {
        facts.lastUpdatedTitle = updatedMatch[1].trim();
        facts.lastUpdatedRelative = updatedMatch[2].trim();
    }
    const downloadsMatch = html.match(/Downloads<\/div><div[^>]*>([^<]+)</);
    if (downloadsMatch) facts.downloads = downloadsMatch[1].trim();
    // 记分卡顶部会列最近发布版本号，用来判断目录侧最新可见版本
    facts.siteEntries = [...new Set((html.match(/\d+\.\d+\.\d+/g) || []))].slice(0, 8);
} catch (e) {
    facts.errors.push(`读取插件页失败: ${e instanceof Error ? e.message : String(e)}`);
}

try {
    const raw = await getText(LIST_URL);
    const list = JSON.parse(raw);
    const hit = list.find((entry) => entry.id === pluginId);
    facts.inMarketList = Boolean(hit);
} catch (e) {
    facts.errors.push(`读取 community-plugins.json 失败: ${e instanceof Error ? e.message : String(e)}`);
}

try {
    const feed = await getText(FEED_URL);
    facts.feedVersions = [...new Set((feed.match(/<title>[^<]*?(\d+\.\d+\.\d+)[^<]*<\/title>/g) || [])
        .map((t) => (t.match(/\d+\.\d+\.\d+/) || [''])[0])
        .filter(Boolean))].slice(0, 5);
} catch (e) {
    facts.errors.push(`读取 RSS 失败: ${e instanceof Error ? e.message : String(e)}`);
}

const checks = [
    {
        label: `插件页 Current version = ${version}`,
        pass: facts.siteVersion === version,
        detail: facts.siteVersion ? `实际 ${facts.siteVersion}` : '未解析到',
    },
    {
        label: `客户端市场清单包含 ${pluginId}`,
        pass: facts.inMarketList === true,
        detail: facts.inMarketList === null ? '读取失败' : facts.inMarketList ? '已收录' : '未收录',
    },
    {
        label: `RSS 出现 ${version}`,
        pass: facts.feedVersions.includes(version),
        detail: facts.feedVersions.length > 0 ? `最新 ${facts.feedVersions[0]}` : '无条目',
    },
];

console.log(`[check:published] ${pluginId}（manifest ${version}）`);
if (facts.lastUpdatedRelative) {
    console.log(`  目录上次检查：${facts.lastUpdatedRelative}（${facts.lastUpdatedTitle ?? '日期未知'}）${facts.downloads ? ' · 下载 ' + facts.downloads : ''}`);
}
for (const c of checks) {
    console.log(`  ${c.pass ? '✓' : '·'} ${c.label} —— ${c.detail}`);
}
if (facts.errors.length > 0) {
    for (const e of facts.errors) console.log(`  ! ${e}`);
}

const published = checks.every((c) => c.pass);
const target = expectVersion ?? version;
if (published) {
    console.log(`[check:published] 已上架：${version} 可通过 Obsidian 客户端安装`);
    process.exit(0);
}
console.log(`[check:published] 尚未上架到 ${target}（审核未通过或尚未触发复审）`);
if (expectVersion) {
    process.exit(1);
}
process.exit(0);
