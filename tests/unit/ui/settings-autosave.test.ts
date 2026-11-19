/**
 * 设置页「自动保存」徽标 + 高危字段「恢复上次值」（审计 A-15 / C 清单 #18）
 */

import { describe, expect, it, vi } from 'vitest';
import { AutoSaveSnapshot, createRestoreButton } from '@/ui/settings/autosave-snapshot';
import { renderAutoSaveHint } from '@/ui/settings/autosave-hint';
import { FakeEl } from './support/fake-dom';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

describe('AutoSaveSnapshot', () => {
    it('capture 只保留第一次的值（连续改两次仍能退回起点）', () => {
        const snap = new AutoSaveSnapshot();
        snap.capture('endpoint:p1', 'https://a');
        snap.capture('endpoint:p1', 'https://b');
        expect(snap.get('endpoint:p1')).toBe('https://a');
    });

    it('按 key 隔离，clear 后不可用', () => {
        const snap = new AutoSaveSnapshot();
        snap.capture('endpoint:p1', 'https://a');
        snap.capture('apiKey:p2', 'sk-1');
        expect(snap.get('apiKey:p2')).toBe('sk-1');
        snap.clear('endpoint:p1');
        expect(snap.get('endpoint:p1')).toBeUndefined();
    });
});

describe('createRestoreButton', () => {
    it('无快照时禁用，有快照时可点并触发还原', async () => {
        const snap = new AutoSaveSnapshot();
        const parent = new FakeEl('div');
        const onRestore = vi.fn();
        const { button, refresh } = createRestoreButton(parent as unknown as HTMLElement, {
            label: '↩ 恢复上次值',
            title: '还原',
            isAvailable: () => snap.get('k') !== undefined,
            onRestore,
        });
        expect(button.disabled).toBe(true);
        expect(button.className).toContain('nw-api-restore-btn');

        snap.capture('k', 'old');
        refresh();
        expect(button.disabled).toBe(false);
        expect(button.className).not.toContain('disabled');

        button.onclick?.({} as unknown as PointerEvent);
        expect(onRestore).toHaveBeenCalledTimes(1);
    });

    it('禁用时点击不触发还原', () => {
        const parent = new FakeEl('div');
        const onRestore = vi.fn();
        const { button } = createRestoreButton(parent as unknown as HTMLElement, {
            label: 'x',
            title: 'y',
            isAvailable: () => false,
            onRestore,
        });
        button.onclick?.({} as unknown as PointerEvent);
        expect(onRestore).not.toHaveBeenCalled();
    });
});

describe('renderAutoSaveHint', () => {
    it('渲染徽标 + 说明，且重复调用只留一条', () => {
        const panel = new FakeEl('div');
        renderAutoSaveHint(panel as unknown as HTMLElement);
        renderAutoSaveHint(panel as unknown as HTMLElement);
        const bars = panel.children.filter(child => child.className === 'nw-settings-autosave');
        expect(bars).toHaveLength(1);
        expect(bars[0].children.map(child => child.className)).toEqual([
            'nw-settings-autosave-badge',
            'nw-settings-autosave-hint',
        ]);
        expect(bars[0].children[0].textContent).toBe('自动保存');
    });
});

describe('接线不变量', () => {
    const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
    const read = (rel: string): string => readFileSync(resolve(root, rel), 'utf8');

    it('设置页与迷你弹窗都渲染自动保存提示', () => {
        expect(read('ui/settings-tab.ts')).toContain('renderAutoSaveHint(container)');
        expect(read('ui/mini-settings-modal.ts')).toContain('renderAutoSaveHint(panel)');
    });

    it('Base URL 与 API Key 变更前都写入快照，且都有恢复按钮', () => {
        const src = read('ui/settings/api-section.ts');
        expect(src).toContain('apiFieldSnapshots.capture(urlSnapshotKey, raw.endpoint)');
        expect(src).toContain('apiFieldSnapshots.capture(keySnapshotKey, storedKey)');
        const calls = src.split('createRestoreButton(').length - 1;
        expect(calls).toBe(2);
    });
});
