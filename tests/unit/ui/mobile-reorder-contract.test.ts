/**
 * 移动端排序回归（M3-3）。
 *
 * 触屏设备没有 HTML5 drag 事件，章节树与情节画布必须提供点按上移/下移；
 * 场景拖拽的「向下放到目标上半区」差一位缺陷也必须钉住。
 * 这里直接调用实例方法（不渲染 DOM）：排序结果与重编号是唯一真相。
 */

import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../main', () => ({
    default: class NovelWriterPlugin {},
}));

import { ChapterOutlineTreeModal } from '../../../ui/chapter-outline-tree-modal';
import { PlotCanvasModal } from '../../../ui/plot-canvas-modal';
import fs from 'node:fs';
import path from 'node:path';

interface AnyModal {
    volumes: Array<{ chapters: Array<Record<string, unknown>> }>;
    render: () => void;
    [key: string]: unknown;
}

function chapterModal(volumes: AnyModal['volumes']): AnyModal {
    const modal = Object.create(ChapterOutlineTreeModal.prototype) as AnyModal;
    modal.volumes = volumes;
    modal.render = () => undefined;
    return modal;
}

function makeChapter(num: number, scenes: Array<{ sceneNum: number; sceneName: string }> = []) {
    return { chapNum: num, conflict: `冲突${num}`, scenes, sourceIdx: 0, rowLine: num, volIndex: 0 };
}

describe('章节树 — 触屏上移/下移', () => {
    it('场景下移：交换顺序并重编场景号', () => {
        const scenes = [
            { sceneNum: 1, sceneName: '开场' },
            { sceneNum: 2, sceneName: '转折' },
        ];
        const modal = chapterModal([{ chapters: [makeChapter(1, scenes)] }]);
        const chap = modal.volumes[0].chapters[0];

        (modal as unknown as { moveScene: (c: unknown, i: number, d: -1 | 1) => void }).moveScene(chap, 0, 1);

        expect(scenes.map(s => s.sceneName)).toEqual(['转折', '开场']);
        expect(scenes.map(s => s.sceneNum)).toEqual([1, 2]);
    });

    it('章节下移：同卷内交换并按新顺序重编章号', () => {
        const modal = chapterModal([{ chapters: [makeChapter(1), makeChapter(2)] }]);

        (modal as unknown as { moveChapter: (v: number, i: number, d: -1 | 1) => void }).moveChapter(0, 0, 1);

        const chapters = modal.volumes[0].chapters;
        expect(chapters.map(c => c.conflict)).toEqual(['冲突2', '冲突1']);
        expect(chapters.map(c => c.chapNum)).toEqual([1, 2]);
    });

    it('边界上移第一项不改变顺序', () => {
        const modal = chapterModal([{ chapters: [makeChapter(1), makeChapter(2)] }]);
        (modal as unknown as { moveChapter: (v: number, i: number, d: -1 | 1) => void }).moveChapter(0, 0, -1);
        expect(modal.volumes[0].chapters.map(c => c.conflict)).toEqual(['冲突1', '冲突2']);
    });
});

describe('情节画布 — 触屏上移/下移', () => {
    it('章节下移后保存并刷新，顺序已交换', () => {
        const modal = Object.create(PlotCanvasModal.prototype) as AnyModal;
        modal.volumes = [{ chapters: [makeChapter(1), makeChapter(2)] }];
        const saveAll = vi.fn(async () => undefined);
        const refresh = vi.fn();
        modal.saveAll = saveAll;
        modal.refresh = refresh;

        (modal as unknown as { moveChapter: (v: number, i: number, d: -1 | 1) => void }).moveChapter(0, 0, 1);

        expect(modal.volumes[0].chapters.map(c => c.conflict)).toEqual(['冲突2', '冲突1']);
        expect(saveAll).toHaveBeenCalledTimes(1);
        expect(refresh).toHaveBeenCalledTimes(1);
    });
});

describe('接线契约', () => {
    const root = path.resolve(__dirname, '../../..');
    const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');

    it('两个视图都走 shared/array-move，且不再手写场景 splice', () => {
        const tree = read('ui/chapter-outline-tree-modal.ts');
        expect(tree).toContain("from '@/shared/array-move'");
        expect(tree).toContain('moveArrayItemToInsert(chap.scenes');
        expect(tree).not.toContain('chap.scenes.splice(draggedSceneIndex, 1)');
        expect(tree).toContain("aria-label': '上移章节'");
        expect(tree).toContain("aria-label': '下移场景'");

        const canvas = read('ui/plot-canvas-modal.ts');
        expect(canvas).toContain("from '@/shared/array-move'");
        expect(canvas).toContain('moveArrayItemToInsert(srcVol.chapters');
        expect(canvas).toContain("aria-label': '上移章节'");
    });
});
