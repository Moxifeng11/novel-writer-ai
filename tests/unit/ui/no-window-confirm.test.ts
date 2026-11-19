import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

/**
 * 浏览器原生 confirm 不可用测试的对话框（审计 A-6 / C 清单 #6）：
 * 它阻塞渲染线程、样式与 Obsidian 不一致、无法带标题/危险提示，也不可被测试 mock。
 * 本用例是棘轮：ui/ 下不许再出现 window.confirm(。
 */
describe('ui/ 不再使用 window.confirm', () => {
    it('全仓 ui/ 零命中（注释除外）', () => {
        let out = '';
        try {
            out = execFileSync('git', ['grep', '-n', 'window.confirm', '--', 'ui'], { encoding: 'utf8' });
        } catch (error) {
            // git grep 无命中时退出码为 1，不是失败
            const status = (error as { status?: number }).status;
            if (status !== 1) throw error;
        }
        const hits = out.split('\n').filter(line => line.trim().length > 0)
            .filter(line => {
                const code = line.split(':').slice(2).join(':');
                return !code.trim().startsWith('//') && !code.trim().startsWith('*');
            });
        expect(hits).toEqual([]);
    });

    it('硬编码中文确认框已改走 OperationConfirmModal', () => {
        const rebuild = readFileSync('ui/rebuild-chapters-modal.ts', 'utf8');
        const volume = readFileSync('ui/volume-intro-modal.ts', 'utf8');
        expect(rebuild).toContain('OperationConfirmModal.confirm');
        expect(volume).toContain('OperationConfirmModal.confirm');
        expect(rebuild).toContain("t('common.confirmTexts.rebuildChapters.title'");
        expect(volume).toContain("t('common.confirmTexts.deleteVolumeVersion.title'");
    });
});
