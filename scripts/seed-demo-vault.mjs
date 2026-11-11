#!/usr/bin/env node
/**
 * seed-demo-vault.mjs — 生成「最小但真实」的可验证样本 vault（DSH-20261112-12）
 *
 * 缘起：DSH-20261112-08 的运行层验证结论是「三条链路全部无法验证」——不是代码问题，
 * 是真实 vault 里没有可验证样本（知识库 0 本、指纹 0 枚、没有 .project）。
 * 本脚本在 **--out 指定的目录**（默认系统临时目录）造出样本，让
 * `verify-three-flows.mjs` 第一次能在真实数据上把可判定环节从 ❔ 变成 ✅/❌。
 *
 * 路径纪律：所有目录/文件名都从 `shared/paths.ts` 的真实常量值复制（.mjs 不能
 * import TS，每个常量上方标 `@paths` 锚点），不得凭印象硬编码。读取方的解析
 * 格式（frontmatter JSON / `## 类型` / `审核状态:` / `- **核心规则**：`）也逐一
 * 对照过对应解析代码。
 *
 * 安全与幂等：
 *  - 只写 --out 目录下的种子文件（mkdir 递归 + 覆盖写），**绝不删除任何文件**；
 *  - 拒绝把种子写进仓库/vault 本体（检测到 package.json 或 .obsidian/plugins/
 *    novel-writer-ai/scripts 即拒绝，--force 也不放行——这条没有后门）；
 *  - 不含任何凭据；data.json 只写非敏感的向量提供方字段。
 *
 * 用法：
 *   node scripts/seed-demo-vault.mjs                 # 默认 <tmpdir>/nw-demo-vault
 *   node scripts/seed-demo-vault.mjs --out <dir>
 *   node scripts/seed-demo-vault.mjs --json          # 打印写入清单（机器可读）
 *   node scripts/seed-demo-vault.mjs --no-embedding  # data.json 不写向量字段（供断点演示）
 *
 * 验证：node scripts/verify-three-flows.mjs --vault <out>
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// 路径常量（@paths shared/paths.ts —— 逐字复制，勿改）
// ---------------------------------------------------------------------------

/** @paths DEFAULT_PLUGIN_ROOT_DIR */
const PLUGIN_ROOT = '.obsidian/plugins/novel-writer-ai';
/** @paths pluginDataDir() */
const PLUGIN_DATA = `${PLUGIN_ROOT}/data`;
/** @paths DEFAULT_KNOWLEDGE_BASE_DIR */
const KB_DIR = '写作知识库';
/** @paths KB_INDEX_FILE */
const KB_INDEX_FILE = '知识库索引.md';
/** @paths KB_VECTORS_DIR */
const KB_VECTORS_DIR = 'knowledge-vectors';
/** @paths PJ_CONTROL_DIR */
const PJ_CONTROL_DIR = '元文件/04-项目总控';
/** @paths PROJECT_FINGERPRINT_LIBRARY_DIR（项目/模板层指纹目录是「写作指纹库」，不是 fingerprint-library） */
const PROJECT_FP_DIR = '写作指纹库';
/** @paths TEMPLATE_FINGERPRINTS_FILE / GLOBAL_FINGERPRINTS_FILE / PROJECT_FINGERPRINTS_FILE */
const TEMPLATE_FP_FILE = 'template-fingerprints.json';
const GLOBAL_FP_FILE = 'global-fingerprints.json';
const PROJECT_FP_FILE = 'project-fingerprints.json';
/** @paths FINGERPRINT_INTENSITY_CONFIG_FILE */
const INTENSITY_FILE = 'fingerprint-intensity-config.json';
/** @paths pjProjectMeta() */
const projectMeta = (project) => `${project}/.project`;
/** @paths pjWorldview() / SUBDIR_WORLDVIEW_FILE */
const SUBDIR_WORLDVIEW_FILE = '01-世界架构/世界观总览.md';
const projectWorldview = (project) => `${project}/${SUBDIR_WORLDVIEW_FILE}`;
/** @paths pjFanficFile() / pjFanficResearchDir()（workName 段在真实实现里还要过 sanitizeName） */
const projectFanficFile = (project, name) => `${project}/05-同人设定库/${name}.md`;
const projectFanficResearch = (project, workName) => `${project}/05-同人设定库/_资料/${workName}`;

// ---------------------------------------------------------------------------
// 种子内容
// ---------------------------------------------------------------------------

/** 演示项目 id（与仓库测试/真实项目同形态：`长篇小说/<书名>`） */
export const DEMO_PROJECT = '长篇小说/晨星外传';
/** 演示书籍名（sanitizeName 安全：无标点/斜杠） */
export const DEMO_BOOK = '晨星志';
/** 演示同人作品名（与书名同源，考据缓存按它建目录） */
export const DEMO_WORK = '晨星志';
/** 演示书籍 id（isSafeBookId 形态：字母数字下划线连字符） */
export const DEMO_BOOK_ID = 'kb_demo_chenxing';

function fingerprint(id, name, scope, overrides = {}) {
    return {
        id,
        name,
        scope,
        enabled: true,
        source: '种子样本',
        extractedAt: Date.UTC(2026, 0, 2),
        version: 'v2',
        samples: ['晨星在雾里升起来，像一枚没擦亮的铜钉。'],
        tags: [],
        features: {},
        ...overrides,
    };
}

/** 全部种子文件（相对 out 的 posix 路径 → 字符串内容） */
export function seedFiles(options = {}) {
    const now = Date.UTC(2026, 0, 2);
    const files = new Map();

    const put = (rel, content) => files.set(rel.replace(/\\/g, '/'), content);

    // ---- 插件设置（非敏感：只有向量提供方与模型名，凭据一律不写）----
    const settings = options.noEmbedding
        ? {}
        : { vectorProviderType: 'ollama', vectorOllamaModel: 'bge-m3', embeddingModel: 'bge-m3', vectorMode: 'auto' };
    put(`${PLUGIN_ROOT}/data.json`, `${JSON.stringify(settings, null, 2)}\n`);

    // ---- 知识流：1 本书（已拆解、已向量化）+ 源文本 + 向量库索引 ----
    put(`${KB_DIR}/${KB_INDEX_FILE}`, [
        '---',
        JSON.stringify({
            books: [{
                id: DEMO_BOOK_ID,
                name: DEMO_BOOK,
                author: '种子样本',
                wordCount: 42000,
                themeTags: ['示例'],
                techniqueTags: [],
                customTags: [],
                synopsis: '种子脚本生成的演示书籍，用于三条链路的运行层验证。',
                createdAt: now,
                updatedAt: now,
                breakdownStatus: 'completed',
                breakdownProgress: 100,
                vectorStatus: 'done',
                primaryGenre: 'demo_genre',
                genreChannel: 'neutral',
            }],
        }, null, 2),
        '---',
        '',
        '# 知识库索引',
        '',
        '共 1 本书籍。（种子样本）',
        '',
    ].join('\n'));
    put(`${KB_DIR}/${DEMO_BOOK}/${DEMO_BOOK}.txt`, [
        '晨星志（种子样本，非用户作品）',
        '',
        '晨星在雾里升起来，像一枚没擦亮的铜钉。守塔人把灯芯捻短半寸，',
        '替夜里的船留出一格可以走错的水域。潮水退到第七级台阶时，',
        '他听见铁环在礁石上磕了一下，又一下，像有人在数自己的心跳。',
        '',
        '「第七次了。」他对着灯说。灯不回答，灯只管把影子铺在水面上。',
    ].join('\n'));
    put(`${PLUGIN_DATA}/${KB_VECTORS_DIR}/index.json`, `${JSON.stringify({
        version: 1,
        books: [{ bookId: DEMO_BOOK_ID, bookName: DEMO_BOOK, sampleCount: 8 }],
    }, null, 2)}\n`);

    // ---- 风格流：模板层 1 / 全局层 2（启用）/ 项目层 1（启用 + 强度 0.8）----
    put(`${PJ_CONTROL_DIR}/${PROJECT_FP_DIR}/${TEMPLATE_FP_FILE}`, `${JSON.stringify([
        fingerprint('fp_demo_tpl', '种子·模板指纹（仅来源，不注入）', 'template'),
    ], null, 2)}\n`);
    put(`${PLUGIN_DATA}/fingerprint-library/${GLOBAL_FP_FILE}`, `${JSON.stringify([
        fingerprint('fp_demo_g1', '种子·全局指纹一', 'global'),
        fingerprint('fp_demo_g2', '种子·全局指纹二', 'global'),
    ], null, 2)}\n`);
    put(`${DEMO_PROJECT}/${PJ_CONTROL_DIR}/${PROJECT_FP_DIR}/${PROJECT_FP_FILE}`, `${JSON.stringify([
        fingerprint('fp_demo_p1', '种子·项目指纹', 'project'),
    ], null, 2)}\n`);
    put(`${DEMO_PROJECT}/${PJ_CONTROL_DIR}/${PROJECT_FP_DIR}/${INTENSITY_FILE}`, `${JSON.stringify({
        fp_demo_p1: { intensity: 0.8 },
    }, null, 2)}\n`);

    // ---- 约束流：fanfic 项目 + 已审核设定 + 考据缓存 ----
    put(projectMeta(DEMO_PROJECT), [
        '## 类型',
        'fanfic',
        '',
        '## 同人设定路径',
        projectFanficFile(DEMO_PROJECT, '晨星设定'),
        '',
        '## 项目说明',
        '种子脚本生成的演示项目（DSH-20261112-12）。',
        '',
    ].join('\n'));
    put(projectWorldview(DEMO_PROJECT), [
        '# 世界观总览',
        '',
        '灯塔之城「雾港」：每年只有晨星升起的一夜可以离港远航。',
        '（种子样本）',
        '',
    ].join('\n'));
    put(projectFanficFile(DEMO_PROJECT, '晨星设定'), [
        '---',
        '审核状态: approved',
        '审核人: 种子脚本',
        '审核时间: 2026-01-02',
        '---',
        '',
        `# ${DEMO_WORK} 同人设定`,
        '',
        '作品名称: 晨星志',
        '',
        '- **世界观类型**：低魔航海（晨星一年一升）',
        '- **核心规则**：晨星升起之夜离港的船，必须在下一次涨潮前回到雾港，否则船员会忘记自己的名字。',
        '- **必须遵守的原作规则**：守塔人不能离开灯塔超过一夜；灯塔的灯芯每夜只能捻动一次。',
        '- **禁止触及的红线**：不得改写「晨星一年一升」的天象设定；不得让守塔人拥有攻击性能力。',
        '',
    ].join('\n'));
    put(`${projectFanficResearch(DEMO_PROJECT, DEMO_WORK)}/sources.json`, `${JSON.stringify({
        sources: [
            { url: 'https://example.com/chenxing/1', title: '示例来源一（种子）', excerpt: '晨星周期与涨潮时刻的对应关系。' },
            { url: 'https://example.com/chenxing/2', title: '示例来源二（种子）', excerpt: '守塔人规条的三种民间版本。' },
        ],
    }, null, 2)}\n`);

    return files;
}

// ---------------------------------------------------------------------------
// 写盘（幂等：只覆盖种子文件，绝不删除；拒绝写进仓库/vault 本体）
// ---------------------------------------------------------------------------

function resolveOut(arg) {
    if (arg) return path.resolve(arg);
    return path.join(os.tmpdir(), 'nw-demo-vault');
}

/** 仓库/vault 本体特征：命中即拒绝，--force 也不放行 */
function isRepositoryDir(dir) {
    return fs.existsSync(path.join(dir, 'package.json'))
        || fs.existsSync(path.join(dir, '.obsidian', 'plugins', 'novel-writer-ai', 'scripts'))
        || fs.existsSync(path.join(dir, 'main.js'));
}

function main() {
    const argv = process.argv.slice(2);
    let out = resolveOut('');
    let json = false;
    let noEmbedding = false;
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--out') out = resolveOut(argv[++i] ?? '');
        else if (argv[i] === '--json') json = true;
        else if (argv[i] === '--no-embedding') noEmbedding = true;
    }

    if (isRepositoryDir(out)) {
        process.stderr.write(`❌ 拒绝把种子写进仓库/vault 本体：${out}\n   请用 --out 指定一个空目录（默认 <tmpdir>/nw-demo-vault）。\n`);
        process.exitCode = 2;
        return;
    }

    const files = seedFiles({ noEmbedding });
    const written = [];
    for (const [rel, content] of files) {
        const abs = path.join(out, ...rel.split('/'));
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, content, 'utf8');
        written.push(rel);
    }

    if (json) {
        process.stdout.write(`${JSON.stringify({ out, count: written.length, files: written }, null, 2)}\n`);
    } else {
        process.stdout.write(`✅ 种子 vault 就绪：${out}\n`);
        process.stdout.write(`   写入 ${written.length} 个文件（幂等覆盖，未删除任何已有文件）。\n`);
        for (const rel of written) process.stdout.write(`   · ${rel}\n`);
        process.stdout.write(`\n下一步验证：\n`);
        process.stdout.write(`   node scripts/verify-three-flows.mjs --vault "${out}"\n`);
    }
    process.exitCode = 0;
}

main();
