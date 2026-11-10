import { describe, expect, it } from 'vitest';
import {
    DEFAULT_READ_LINES,
    MAX_READ_CHARS,
    extractLineWindow,
    sanitizeVaultPath,
    summarizeHitLine,
    shouldAutoApproveNewFile,
} from '../../../shared/file-path-guard';

describe('file-path-guard — Agent 读文件的路径守卫', () => {
    it('接受普通库内路径并规范化反斜杠/重复斜杠', () => {
        expect(sanitizeVaultPath('项目\\设定\\人物.md')).toEqual({ ok: true, path: '项目/设定/人物.md' });
        expect(sanitizeVaultPath('项目//正文//第1章.md')).toEqual({ ok: true, path: '项目/正文/第1章.md' });
    });

    it('去掉模型常带的包裹引号', () => {
        expect(sanitizeVaultPath('"项目/正文/第1章.md"')).toEqual({ ok: true, path: '项目/正文/第1章.md' });
        expect(sanitizeVaultPath('`项目/大纲.md`')).toEqual({ ok: true, path: '项目/大纲.md' });
    });

    it('拒绝绝对路径与盘符路径', () => {
        expect(sanitizeVaultPath('/etc/passwd').ok).toBe(false);
        expect(sanitizeVaultPath('C:\\Windows\\win.ini').ok).toBe(false);
        expect(sanitizeVaultPath('D:/小说工坊/x.md').ok).toBe(false);
    });

    it('拒绝 .. 与 . 段', () => {
        expect(sanitizeVaultPath('项目/../../secret.md').ok).toBe(false);
        expect(sanitizeVaultPath('./项目/x.md').ok).toBe(false);
    });

    it('拒绝隐藏目录，但允许白名单前缀（spill 存档）', () => {
        expect(sanitizeVaultPath('.obsidian/app.json').ok).toBe(false);
        expect(sanitizeVaultPath('.trash/旧稿.md').ok).toBe(false);
        expect(sanitizeVaultPath('.sessions/spill/agent/项目/x.md').ok).toBe(false);
        expect(sanitizeVaultPath('.sessions/spill/agent/项目/x.md', { allowHiddenPrefixes: ['.sessions/'] }))
            .toEqual({ ok: true, path: '.sessions/spill/agent/项目/x.md' });
    });

    it('空路径与控制字符不通过', () => {
        expect(sanitizeVaultPath('   ').ok).toBe(false);
        expect(sanitizeVaultPath('项目/\u0001.md').ok).toBe(false);
    });
});

describe('file-path-guard — 行窗口', () => {
    const text = ['第一行', '第二行', '第三行', '第四行', '第五行'].join('\n');

    it('默认返回全文并报告总行数', () => {
        const window = extractLineWindow(text);
        expect(window.startLine).toBe(1);
        expect(window.endLine).toBe(5);
        expect(window.totalLines).toBe(5);
        expect(window.truncated).toBe(false);
        expect(window.text.split('\n')).toHaveLength(5);
    });

    it('offset/limit 按 1-based 行号切分', () => {
        const window = extractLineWindow(text, { offset: 2, limit: 2 });
        expect(window.text).toBe('第二行\n第三行');
        expect(window.startLine).toBe(2);
        expect(window.endLine).toBe(3);
        expect(window.truncated).toBe(true);
        expect(window.charLimited).toBe(false);
    });

    it('offset 超出总行数时返回空窗口而不越界', () => {
        const window = extractLineWindow(text, { offset: 99 });
        expect(window.text).toBe('');
        // startLine/endLine 回显请求位置，totalLines 仍是真实行数（模型据此判断已到末尾）
        expect(window.startLine).toBe(99);
        expect(window.endLine).toBe(99);
        expect(window.totalLines).toBe(5);
        expect(window.truncated).toBe(false);
    });

    it('字符上限优先：超长首行被截断并标记 charLimited', () => {
        const long = '甲'.repeat(MAX_READ_CHARS + 500);
        const window = extractLineWindow(long, { maxChars: 400 });
        expect(window.charLimited).toBe(true);
        expect(window.text.length).toBe(400);
        expect(window.truncated).toBe(true);
    });

    it('字符上限按累计长度收缩，endLine 是实际包含的最后一行', () => {
        const lines = Array.from({ length: 50 }, (_, index) => `${index}`.padEnd(100, '·'));
        const window = extractLineWindow(lines.join('\n'), { limit: 50, maxChars: 350 });
        expect(window.endLine).toBeLessThanOrEqual(4);
        expect(window.charLimited).toBe(true);
        expect(window.text.length).toBeLessThanOrEqual(350);
    });

    it('默认行数符合常量', () => {
        expect(DEFAULT_READ_LINES).toBe(200);
    });
});

describe('file-path-guard — 命中行摘要', () => {
    it('去掉标题/引用/列表前缀并压空白', () => {
        expect(summarizeHitLine('##   武昭 出现在   断刃城 ')).toBe('武昭 出现在 断刃城');
        expect(summarizeHitLine('> 引用的一句话')).toBe('引用的一句话');
        expect(summarizeHitLine('- 列表项')).toBe('列表项');
    });

    it('超长行截断并加省略号', () => {
        const summary = summarizeHitLine('字'.repeat(50), 10);
        expect(summary).toHaveLength(10);
        expect(summary.endsWith('…')).toBe(true);
    });
});

describe('shouldAutoApproveNewFile — 覆盖确认不可被引号路径绕过（v4.79.0 安全审计）', () => {
    it('带引号且净化后已存在的路径必须走确认', async () => {
        const exists = async (p: string) => p === '项目/正文/第1章_正文.md';
        await expect(shouldAutoApproveNewFile('"项目/正文/第1章_正文.md"', exists)).resolves.toBe(false);
    });

    it('净化后不存在的新文件可自动放行', async () => {
        await expect(shouldAutoApproveNewFile('项目/正文/第9章_正文.md', async () => false)).resolves.toBe(true);
    });

    it('非法路径与探测异常一律走确认', async () => {
        await expect(shouldAutoApproveNewFile('../../etc/passwd', async () => false)).resolves.toBe(false);
        await expect(shouldAutoApproveNewFile('项目/x.md', async () => { throw new Error('io'); })).resolves.toBe(false);
    });

    it('allowedPrefix：新文件只在当前项目内自动放行（S2-8）', async () => {
        const exists = async () => false;
        await expect(shouldAutoApproveNewFile('长篇小说/书A/设定.md', exists, '长篇小说/书A')).resolves.toBe(true);
        await expect(shouldAutoApproveNewFile('长篇小说/书B/x.md', exists, '长篇小说/书A')).resolves.toBe(false);
        await expect(shouldAutoApproveNewFile('长篇小说/书A/../书B/x.md', exists, '长篇小说/书A')).resolves.toBe(false);
        await expect(shouldAutoApproveNewFile('库根.md', exists, '')).resolves.toBe(false);
    });
});
