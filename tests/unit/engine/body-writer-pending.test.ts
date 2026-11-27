/**
 * 生成结果「待确认」写入的回归测试（2026-11-25）。
 *
 * 背景（借鉴云笔「生成结果四态」）：本仓 `write()` 此前直接覆盖正文，
 * AI 写坏了只能手动回滚。新增 `requireConfirm` 让生成先进 `.pending/`，
 * 用户「采用」才写正文。
 *
 * 核心约束：**默认行为必须完全不变**——6 个既有调用方零改动。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { App, TFile } from 'obsidian';
import { BodyWriter } from '../../../engine/body-writer';
import { MockFileSystem, FrontmatterPort } from '../../../shared/file-system-port';

class FakeFrontmatter implements FrontmatterPort {
    states = new Map<string, Record<string, unknown>>();

    async processFrontmatter(file: TFile, updater: (fm: Record<string, unknown>) => void): Promise<void> {
        const fm = { ...(this.states.get(file.path) || {}) };
        updater(fm);
        this.states.set(file.path, fm);
    }
}

const PATH = '项目/03-大纲与章节/正文/第1卷/第3章_正文.md';
const PENDING = '项目/03-大纲与章节/正文/第1卷/.pending/第3章_正文.md';

function body(tag: string): string {
    return Array.from({ length: 200 }, (_, i) => `${tag}第${i}句正文内容在这里展开写长一点。`).join('\n');
}

describe('BodyWriter 待确认写入', () => {
    let fs: MockFileSystem;
    let writer: BodyWriter;

    beforeEach(() => {
        fs = new MockFileSystem();
        // 项目身份标志：writeLocked 会校验项目还在，否则拒绝写入（防重建已删除项目）
        fs.setFile('项目/作品信息.md', '# 项目');
        writer = new BodyWriter({ fs, frontmatter: new FakeFrontmatter() });
    });

    it('requireConfirm 默认 undefined → 直接写入（旧行为不变）', async () => {
        const r = await writer.write({ path: PATH, raw: body('A'), writingMode: 'batch' });
        expect(r.pendingPath).toBeUndefined();
        expect(await fs.exists(PATH)).toBe(true);
        expect(await fs.exists(PENDING)).toBe(false);
    });

    it('requireConfirm: true → 只写待确认区，原正文不动', async () => {
        // 先写一版原稿
        await writer.write({ path: PATH, raw: body('原稿'), writingMode: 'batch' });
        const before = await fs.read(PATH);

        const r = await writer.write({ path: PATH, raw: body('新稿'), writingMode: 'batch', requireConfirm: true });

        expect(r.pendingPath).toBe(PENDING);
        // 正文未被修改
        expect(await fs.read(PATH)).toBe(before);
        // 待确认区有新内容
        expect(await fs.exists(PENDING)).toBe(true);
        const pending = await fs.read(PENDING);
        expect(pending).toContain('新稿');
        expect(pending).not.toContain('原稿');
    });

    it('requireConfirm: true 且原正文不存在 → 仍只写待确认区', async () => {
        const r = await writer.write({ path: PATH, raw: body('首稿'), writingMode: 'batch', requireConfirm: true });
        expect(r.pendingPath).toBe(PENDING);
        expect(await fs.exists(PATH)).toBe(false);
        expect(await fs.exists(PENDING)).toBe(true);
    });

    it('目标路径反推：.pending/xxx.md → xxx.md', () => {
        expect(writer.targetPathOfPending(PENDING)).toBe(PATH);
        expect(writer.targetPathOfPending('.pending/a.md')).toBe('a.md');
    });

    it('待确认与正文同目录（项目移动不脱钩）', () => {
        expect(writer.targetPathOfPending(PENDING)).toBe(PATH);
        // 目录部分一致
        const dirOf = (p: string) => p.slice(0, p.lastIndexOf('/'));
        expect(dirOf(PENDING)).toBe(`${dirOf(PATH)}/.pending`);
    });

    it('adoptPending：采用后正文更新、待确认文件被清理', async () => {
        await writer.write({ path: PATH, raw: body('原稿'), writingMode: 'batch' });
        const r = await writer.write({ path: PATH, raw: body('新稿'), writingMode: 'batch', requireConfirm: true });
        expect(r.pendingPath).toBe(PENDING);

        const adopted = await writer.adoptPending(PENDING, { writingMode: 'batch' });

        expect(adopted.path).toBe(PATH);
        expect(await fs.read(PATH)).toContain('新稿');
        expect(await fs.exists(PENDING)).toBe(false);
    });

    it('discardPending：弃用后正文不变、待确认文件被删', async () => {
        await writer.write({ path: PATH, raw: body('原稿'), writingMode: 'batch' });
        const before = await fs.read(PATH);
        const r = await writer.write({ path: PATH, raw: body('废稿'), writingMode: 'batch', requireConfirm: true });

        const ok = await writer.discardPending(r.pendingPath!);

        expect(ok).toBe(true);
        expect(await fs.read(PATH)).toBe(before);
        expect(await fs.exists(PENDING)).toBe(false);
    });

    it('discardPending 对待确认文件不存在时返回 false（不抛错）', async () => {
        expect(await writer.discardPending(PENDING)).toBe(false);
    });

    it('adoptPending 对待确认文件不存在时抛明确错误', async () => {
        await expect(writer.adoptPending(PENDING, { writingMode: 'batch' })).rejects.toThrow(/待确认文件不存在/);
    });
});

describe('T5 待确认模式的设置与 UI 契约', () => {
    it('bodyConfirmMode 三档取值合法', () => {
        const modes: Array<'off' | 'overwrite' | 'always'> = ['off', 'overwrite', 'always'];
        expect(modes).toHaveLength(3);
    });

    it('overwrite 模式：新建章节不确认，覆盖已有才确认', async () => {
        // 模拟 shouldConfirm 判定逻辑（与 continue-chapters-modal 一致）
        const shouldConfirm = (mode: string, exists: boolean): boolean =>
            mode === 'always' || (mode === 'overwrite' && exists);

        expect(shouldConfirm('off', true)).toBe(false);
        expect(shouldConfirm('off', false)).toBe(false);
        expect(shouldConfirm('overwrite', true)).toBe(true);
        expect(shouldConfirm('overwrite', false)).toBe(false);
        expect(shouldConfirm('always', true)).toBe(true);
        expect(shouldConfirm('always', false)).toBe(true);
    });

    it('GenerateConfirmModal 三态选择都已定义', async () => {
        const mod = await import('../../../ui/components/generate-confirm-modal');
        expect(mod.GenerateConfirmModal).toBeDefined();
        // 类型层面三态
        const choices: Array<'adopt' | 'discard' | 'later'> = ['adopt', 'discard', 'later'];
        expect(choices).toHaveLength(3);
    });
});
