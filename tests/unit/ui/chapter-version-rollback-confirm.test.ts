/**
 * chapter-version-rollback-confirm.test.ts — 回滚确认统一走 OperationConfirmModal（审计 A-7）
 *
 * 背景：回滚原本有一套自建 RollbackConfirmModal，与「删除卷简介版本」用的
 * OperationConfirmModal 分裂。A-7 要求破坏性操作按风险分级统一到同一套确认组件：
 * 回滚会自动备份当前版本（可恢复），因此用普通确认即可。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ChapterVersionModal } from '../../../ui/chapter-version-modal';
import { OperationConfirmModal } from '../../../ui/components/progress/operation-confirm-modal';
import { setLocale, translate, hasMessage } from '../../../i18n';
import type { DiffStats, VersionMeta } from '../../../shared/version-types';
import type { EngineRegistry } from '../../../engine/engine-registry';
import type { App } from 'obsidian';
import { stubDocument } from './support/fake-dom';

const MODAL_SRC = fs.readFileSync(
    path.resolve(__dirname, '../../../ui/chapter-version-modal.ts'),
    'utf8',
);

function makeVersion(overrides: Partial<VersionMeta> = {}): VersionMeta {
    return {
        id: 'v2',
        version: 2,
        createdAt: '2026-11-21T10:00:00.000Z',
        type: 'ai-generate',
        contentType: 'chapter',
        wordCount: 1234,
        wordCountDelta: 100,
        lineCount: 40,
        tags: [],
        note: '',
        project: '书甲',
        contentKey: '第1章',
        sourcePath: '书甲/01-正文/第1章.md',
        versionPath: '书甲/.versions/第1章/v2.md',
        ...overrides,
    };
}

function makeModal(options: { onRollback?: (v: VersionMeta) => Promise<void> } = {}) {
    const service = {
        listVersions: async () => [],
        getVersionContent: async () => '',
        saveVersion: async () => null,
        deleteVersion: async () => undefined,
        restoreVersion: async () => undefined,
    };
    const registry = { get: () => service } as unknown as EngineRegistry;
    const app = {} as unknown as App;
    return new ChapterVersionModal(app, {
        project: '书甲',
        contentType: 'chapter',
        contentKey: '第1章',
        sourcePath: '书甲/01-正文/第1章.md',
        currentContent: '当前正文',
        onRollback: options.onRollback,
    }, registry);
}

function callConfirmRollback(modal: ChapterVersionModal, version: VersionMeta): Promise<void> {
    const target = modal as unknown as { confirmRollback(v: VersionMeta): Promise<void> };
    return target.confirmRollback(version);
}

function setDiffStats(modal: ChapterVersionModal, stats: DiffStats | null): void {
    (modal as unknown as { diffStats: DiffStats | null }).diffStats = stats;
}

describe('回滚确认统一到 OperationConfirmModal', () => {
    beforeEach(() => {
        stubDocument();
        setLocale('zh-CN');
    });
    afterEach(() => {
        vi.restoreAllMocks();
        delete (globalThis as unknown as { document?: unknown }).document;
    });

    it('源码里不再有自建回滚弹窗与它的样式类', () => {
        expect(MODAL_SRC).not.toContain('RollbackConfirmModal');
        expect(MODAL_SRC).not.toContain('nw-rollback-');
        const css = fs.readFileSync(
            path.resolve(__dirname, '../../../styles-src/06-cowrite-missing-and-dark.css'),
            'utf8',
        );
        expect(css).not.toContain('.nw-rollback-');
        expect(MODAL_SRC).toContain('OperationConfirmModal.confirm');
    });

    it('确认框带版本类型、时间、字数与预计变化，并提示会自动备份', async () => {
        const spy = vi.spyOn(OperationConfirmModal, 'confirm').mockResolvedValue(false);
        const modal = makeModal();
        setDiffStats(modal, { addedLines: 3, deletedLines: 2, modifiedLines: 1, unchangedLines: 5, totalLines: 11, changeRatio: 0.5, addedChars: 12, deletedChars: 8 });

        await callConfirmRollback(modal, makeVersion());

        expect(spy).toHaveBeenCalledTimes(1);
        const options = spy.mock.calls[0][1];
        expect(options.title).toBe('确认回滚到 v2？');
        expect(options.description).toContain('版本类型：AI生成');
        expect(options.description).toContain('字数：1234 字');
        expect(options.description).toContain('预计变化：+3 行 / -2 行 / ~1 行');
        expect(options.warning).toContain('自动保存当前版本作为备份');
        expect(options.confirmText).toBe('确认回滚');
        expect(options.cancelText).toBe('取消');
    });

    it('备注只在有值时出现', async () => {
        const spy = vi.spyOn(OperationConfirmModal, 'confirm').mockResolvedValue(false);
        const modal = makeModal();
        setDiffStats(modal, null);

        await callConfirmRollback(modal, makeVersion({ note: '润色前的版本' }));
        expect(spy.mock.calls[0][1].description).toContain('备注：润色前的版本');
        expect(spy.mock.calls[0][1].description).not.toContain('预计变化');

        await callConfirmRollback(modal, makeVersion({ note: '' }));
        expect(spy.mock.calls[1][1].description).not.toContain('备注：');
    });

    it('取消不触发回滚，确认后回滚一次并关闭', async () => {
        const onRollback = vi.fn(async () => undefined);
        const spy = vi.spyOn(OperationConfirmModal, 'confirm').mockResolvedValue(false);
        const modal = makeModal({ onRollback });
        const closeSpy = vi.spyOn(modal, 'close');

        await callConfirmRollback(modal, makeVersion());
        expect(onRollback).not.toHaveBeenCalled();
        expect(closeSpy).not.toHaveBeenCalled();

        spy.mockResolvedValue(true);
        await callConfirmRollback(modal, makeVersion());
        expect(onRollback).toHaveBeenCalledTimes(1);
        expect(closeSpy).toHaveBeenCalledTimes(1);
    });

    it('中英文案都可解析，且英文不含中文', () => {
        const keys = [
            'versionModal.rollback.title',
            'versionModal.rollback.desc',
            'versionModal.rollback.note',
            'versionModal.rollback.stats',
            'versionModal.rollback.backup',
            'versionModal.rollback.confirm',
            'versionModal.rollback.done',
        ];
        for (const key of keys) {
            expect(hasMessage(key)).toBe(true);
            expect(translate('zh-CN', key, { version: '2', type: 'AI 生成', time: '昨天', words: '10', note: 'n', added: '1', deleted: '2', modified: '3' })).not.toBe(key);
        }
        for (const key of keys) {
            const text = translate('en-US', key, { version: '2', type: 'AI', time: 'yesterday', words: '10', note: 'n', added: '1', deleted: '2', modified: '3' });
            expect(text).not.toBe(key);
            expect(/[\u4e00-\u9fff]/.test(text)).toBe(false);
        }
    });
});
