#!/usr/bin/env node
/**
 * handoff.mjs — ZCode ↔ Trae 单快照交接
 *
 * 只维护 Vault 根 `PROJECT-RULES.md` 中 `<!-- HANDOFF:START --> … <!-- HANDOFF:END -->`
 * 之间的 10 行快照；不重写正文、不扫描对方目录。
 *
 * 用法：
 *   node scripts/handoff.mjs --from zcode --doing "..." --next-trae "..."
 *   node scripts/handoff.mjs --from trae --stage "加固阶段" --delivered "..."
 *   node scripts/handoff.mjs --check
 *   node scripts/handoff.mjs --print
 *
 * 自动字段：更新时间 / 版本 / 提交 / ahead。未传的字段保留原值。
 * 每次更新追加一行到 `.trae/HANDOFF-LOG.md`（可用 --no-log 关闭）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(__dirname, '..');
const vaultRoot = path.resolve(pluginRoot, '..', '..', '..');
const defaultRulesPath = path.join(vaultRoot, 'PROJECT-RULES.md');
const logPath = path.join(vaultRoot, '.trae', 'HANDOFF-LOG.md');

const FIELD_ORDER = [
    '更新时间',
    '版本 / 提交',
    '当前阶段',
    '最近交付',
    '正在进行',
    '下一步（ZCode）',
    '下一步（Trae）',
    '待确认',
    '详情',
];

const REQUIRED_FIELDS = ['版本 / 提交', '当前阶段', '下一步（ZCode）', '下一步（Trae）'];

function parseArgs(argv) {
    const out = { from: null, file: defaultRulesPath, log: true, check: false, print: false };
    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        const value = () => {
            const v = argv[i + 1];
            if (v == null || v.startsWith('--')) throw new Error(`${arg} 缺少值`);
            i += 1;
            return v;
        };
        switch (arg) {
            case '--from': out.from = value(); break;
            case '--file': out.file = value(); break;
            case '--stage': out.stage = value(); break;
            case '--delivered': out.delivered = value(); break;
            case '--doing': out.doing = value(); break;
            case '--next-zcode': out.nextZcode = value(); break;
            case '--next-trae': out.nextTrae = value(); break;
            case '--ask': out.ask = value(); break;
            case '--details': out.details = value(); break;
            case '--no-log': out.log = false; break;
            case '--check': out.check = true; break;
            case '--print': out.print = true; break;
            case '--help':
            case '-h':
                console.log('用法: node scripts/handoff.mjs --from zcode|trae [--stage ...] [--delivered ...] [--doing ...] [--next-zcode ...] [--next-trae ...] [--ask ...] [--details ...] [--no-log] [--check] [--print]');
                process.exit(0);
                break;
            default:
                throw new Error(`未知参数: ${arg}`);
        }
    }
    return out;
}

function nowLocal() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const offset = -d.getTimezoneOffset();
    const sign = offset >= 0 ? '+' : '-';
    const abs = Math.abs(offset);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
        + `T${pad(d.getHours())}:${pad(d.getMinutes())}`
        + `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

function git(args) {
    try {
        return execFileSync('git', args, { cwd: pluginRoot, encoding: 'utf8' }).trim();
    } catch {
        return null;
    }
}

function autoVersionLine() {
    let version = '?';
    try {
        version = JSON.parse(fs.readFileSync(path.join(pluginRoot, 'package.json'), 'utf8')).version || '?';
    } catch {
        // 保留 '?'，不阻断交接
    }
    const commit = git(['rev-parse', '--short', 'HEAD']) || '?';
    const ahead = git(['rev-list', '--count', 'origin/master..HEAD']) || '?';
    return `v${version} / ${commit} / ahead ${ahead}`;
}

function parseBlock(text) {
    const match = text.match(/<!-- HANDOFF:START -->([\s\S]*?)<!-- HANDOFF:END -->/);
    if (!match) return null;
    const fields = {};
    for (const line of match[1].split('\n')) {
        const m = line.match(/^- (.+?)：(.+)$/);
        if (m) fields[m[1].trim()] = m[2].trim();
    }
    return { fields, raw: match[0] };
}

function renderBlock(fields) {
    const lines = ['<!-- HANDOFF:START -->'];
    for (const key of FIELD_ORDER) {
        lines.push(`- ${key}：${fields[key] ?? ''}`);
    }
    lines.push('<!-- HANDOFF:END -->');
    return lines.join('\n');
}

function appendLog(from, fields, versionLine) {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    if (!fs.existsSync(logPath)) {
        fs.writeFileSync(logPath, '# 交接日志（HANDOFF-LOG）\n\n> 由 `scripts/handoff.mjs` 追加；只增不改。\n\n', 'utf8');
    }
    const summary = [
        fields['当前阶段'] ? `阶段=${fields['当前阶段']}` : '',
        fields['正在进行'] ? `进行=${fields['正在进行']}` : '',
        fields['下一步（Trae）'] ? `Trae=${fields['下一步（Trae）']}` : '',
        fields['待确认'] ? `待确认=${fields['待确认']}` : '',
    ].filter(Boolean).join('；');
    const line = `- ${fields['更新时间']} [${from}] ${summary} | ${versionLine}\n`;
    fs.appendFileSync(logPath, line, 'utf8');
}

function main() {
    const args = parseArgs(process.argv.slice(2));
    if (!fs.existsSync(args.file)) {
        throw new Error(`找不到规范文件: ${args.file}`);
    }
    const text = fs.readFileSync(args.file, 'utf8');
    const parsed = parseBlock(text);

    if (args.check) {
        if (!parsed) throw new Error('HANDOFF 标记缺失（需要 <!-- HANDOFF:START --> / <!-- HANDOFF:END -->）');
        const missing = REQUIRED_FIELDS.filter((key) => !parsed.fields[key]);
        if (missing.length > 0) throw new Error(`快照缺少字段: ${missing.join('、')}`);
        console.log(`✅ HANDOFF 快照通过检查（${parsed.fields['版本 / 提交']}）`);
        return;
    }
    if (args.print) {
        if (!parsed) throw new Error('HANDOFF 标记缺失');
        console.log(parsed.raw);
        return;
    }
    if (!parsed) throw new Error('HANDOFF 标记缺失，先在本文件中加入 START/END 标记');
    if (!args.from) throw new Error('缺少 --from zcode|trae');

    const versionLine = autoVersionLine();
    const fields = { ...parsed.fields };
    fields['更新时间'] = nowLocal();
    fields['版本 / 提交'] = versionLine;
    if (args.stage != null) fields['当前阶段'] = args.stage;
    if (args.delivered != null) fields['最近交付'] = args.delivered;
    if (args.doing != null) fields['正在进行'] = args.doing;
    if (args.nextZcode != null) fields['下一步（ZCode）'] = args.nextZcode;
    if (args.nextTrae != null) fields['下一步（Trae）'] = args.nextTrae;
    if (args.ask != null) fields['待确认'] = args.ask;
    if (args.details != null) fields['详情'] = args.details;

    const updated = text.replace(parsed.raw, renderBlock(fields));
    fs.writeFileSync(args.file, updated, 'utf8');
    if (args.log) appendLog(args.from, fields, versionLine);

    console.log(`✅ 已更新交接快照（${args.from}）`);
    console.log(renderBlock(fields));
}

try {
    main();
} catch (error) {
    console.error(`❌ handoff 失败：${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
}
