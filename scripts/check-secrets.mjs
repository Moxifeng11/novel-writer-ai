#!/usr/bin/env node
/**
 * check-secrets.mjs — 推送前密钥泄露门禁（v4.79.0）
 *
 * 背景（用户 2026-11-09 明确要求）：`git push` 后仓库公开，必须确定不会把 API Key
 * 或加密密文带出去。`data.json` / `data/` / `.sessions/` / `.trae/` 已在 .gitignore，
 * 但「被忽略」只防当前文件，防不住以后有人把密钥写进代码、文档、测试夹具或强行 add。
 * 这里对**被 git 跟踪的文件**做两层检查：
 *
 *  1) 密钥形态：OpenAI 风格 `sk-…`、火山 `oc_sk_…`、真实密文载荷、长 Bearer token；
 *  2) 禁止入库路径：data.json / data/** / .sessions/** / .trae/** / *.bak。
 *
 * 只扫 `git ls-files`：本地 data.json 有真实 Key 也不会误报（它本来就不该被跟踪）。
 * 命中时**只打印脱敏片段**（保留首尾 3-4 字符），绝不把完整密钥写进 CI 日志。
 *
 * 用法：
 *   node scripts/check-secrets.mjs
 *   node scripts/check-secrets.mjs --root <dir>   # 测试夹具（需是 git 仓库）
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(SCRIPT_DIR, '..');

/** 命中即视为泄露的密钥形态（阈值刻意调高，避免测试夹具误报） */
const SECRET_PATTERNS = [
    { id: 'openai-key', pattern: /sk-[A-Za-z0-9_-]{20,}/g },
    { id: 'volc-key', pattern: /oc_sk_[A-Za-z0-9]{8,}/g },
    { id: 'ciphertext-v2', pattern: /aes256v2:\d+:[^\s:]+:[^\s:]+:[A-Za-z0-9+/=]{32,}/g },
    { id: 'ciphertext-v1', pattern: /aes256:[^\s:]+:[A-Za-z0-9+/=]{32,}/g },
    { id: 'bearer-token', pattern: /Bearer [A-Za-z0-9._-]{30,}/g },
];

/** 这些路径一旦被跟踪就是泄露面（本应被 .gitignore 挡住） */
const FORBIDDEN_TRACKED = [
    /^data\.json$/,
    /(^|\/)data\//,
    /^\.sessions\//,
    // .trae/automation 的 canonical 台账是有意入库的；只禁止可能含正文/密钥的本地信箱
    /^\.trae\/mailbox\//,
    /\.bak\d*$/,
];

function parseArgs(argv) {
    const args = { root: DEFAULT_ROOT, json: false };
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--root') args.root = path.resolve(argv[++i] || DEFAULT_ROOT);
        else if (argv[i] === '--json') args.json = true;
    }
    return args;
}

/** 脱敏展示：只留首尾，绝不打印完整值 */
function mask(secret) {
    if (secret.length <= 10) return `${secret.slice(0, 2)}***`;
    return `${secret.slice(0, 4)}***${secret.slice(-3)}`;
}

function listTrackedFiles(root) {
    const result = spawnSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (result.status !== 0) return null;
    return result.stdout.split('\0').filter(Boolean);
}

function isBinary(buf) {
    const sample = buf.subarray(0, 8192);
    return sample.includes(0);
}

function scan(root) {
    const tracked = listTrackedFiles(root);
    if (!tracked) return { error: `not-a-git-repo: ${root}` };
    const findings = [];
    for (const rel of tracked) {
        for (const rule of FORBIDDEN_TRACKED) {
            if (rule.test(rel)) {
                findings.push({ kind: 'forbidden-path', file: rel, line: 0, rule: 'forbidden-path', excerpt: rel });
                break;
            }
        }
        const abs = path.join(root, rel);
        let buf;
        try {
            buf = fs.readFileSync(abs);
        } catch {
            continue;
        }
        if (isBinary(buf)) continue;
        const text = buf.toString('utf8');
        const lines = text.split('\n');
        for (const { id, pattern } of SECRET_PATTERNS) {
            pattern.lastIndex = 0;
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                pattern.lastIndex = 0;
                let match;
                while ((match = pattern.exec(line)) !== null) {
                    findings.push({
                        kind: 'secret-pattern',
                        file: rel,
                        line: i + 1,
                        rule: id,
                        excerpt: mask(match[0]),
                    });
                }
            }
        }
    }
    return { findings, scanned: tracked.length };
}

function main() {
    const args = parseArgs(process.argv.slice(2));
    const result = scan(args.root);
    if (args.json) {
        console.log(JSON.stringify(result, null, 2));
        return result.findings && result.findings.length > 0 ? 1 : 0;
    }
    if (result.error) {
        console.error(`❌ ${result.error}`);
        return 1;
    }
    if (result.findings.length === 0) {
        console.log(`✅ 密钥门禁通过：${result.scanned} 个被跟踪文件未发现密钥/密文/禁止入库路径`);
        return 0;
    }
    console.error(`❌ 发现 ${result.findings.length} 处潜在泄露（值已脱敏）：`);
    for (const f of result.findings.slice(0, 30)) {
        const where = f.line > 0 ? `${f.file}:${f.line}` : f.file;
        console.error(`  - [${f.rule}] ${where} → ${f.excerpt}`);
    }
    if (result.findings.length > 30) console.error(`  … 其余 ${result.findings.length - 30} 处略`);
    console.error('  处理：把密钥移出仓库（data.json 等走 .gitignore），或确认是假夹具后用短占位符。');
    return 1;
}

process.exitCode = main();
