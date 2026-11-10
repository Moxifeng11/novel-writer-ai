import { describe, expect, it, vi } from 'vitest';
import { App } from '../../__mocks__/obsidian';
import { listModeUnits } from '../../../shared/mode-content';

/**
 * P2-3（维度⑤二轮）：选择页初始渲染复用整页 files 快照。
 * `listModeUnits` 此前每调用一次就全库 getFiles，短篇/剧本项目每个卡片各一次。
 */
const PROJECT = '短篇小说/测试书';

describe('listModeUnits — 文件快照复用', () => {
    it('传入快照时不再调用 vault.getFiles，结果与实时扫描一致', () => {
        const app = new App();
        (app.vault as unknown as { _seedFile: (p: string, c: string) => void })._seedFile(
            `${PROJECT}/短篇创作/03-正文/第01节.md`,
            '---\nstatus: written\n---\n正文',
        );
        const live = listModeUnits(app as never, PROJECT, 'short');
        const snapshot = app.vault.getFiles();
        const spy = vi.spyOn(app.vault, 'getFiles');
        spy.mockClear();

        const cached = listModeUnits(app as never, PROJECT, 'short', snapshot);

        expect(spy).not.toHaveBeenCalled();
        expect(cached).toHaveLength(live.length);
        expect(cached.map(unit => unit.unitName)).toEqual(live.map(unit => unit.unitName));
        spy.mockRestore();
    });
});
