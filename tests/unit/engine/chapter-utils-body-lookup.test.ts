import { describe, expect, it } from 'vitest';
import { findBodyFileByChapterNum } from '../../../engine/chapter-utils';

const file = (path: string) => ({ path, name: path.split('/').pop() || '' }) as any;

describe('chapter-utils — 卷目录按章号找正文', () => {
    const bodyDir = '书/03-大纲与章节/正文/第1卷';
    const files = [
        file(`${bodyDir}/第1章_九脉逆行_正文.md`),
        file(`${bodyDir}/第2章_锁痕_正文.md`),
        file(`${bodyDir}/第10章_余烬_正文.md`),
    ];

    it('按章号命中，不会返回卷内第一个正文（防新章写进旧章）', () => {
        expect(findBodyFileByChapterNum(files, bodyDir, 2)?.name).toBe('第2章_锁痕_正文.md');
        expect(findBodyFileByChapterNum(files, bodyDir, 10)?.name).toBe('第10章_余烬_正文.md');
    });

    it('不会把第1章误匹配成第10章', () => {
        const only10 = [file(`${bodyDir}/第10章_余烬_正文.md`)];
        expect(findBodyFileByChapterNum(only10, bodyDir, 1)).toBeUndefined();
    });

    it('章名与文件名不一致时按 `第N章` 前缀仍能找到', () => {
        const renamed = [file(`${bodyDir}/第3章_改名后_正文.md`)];
        expect(findBodyFileByChapterNum(renamed, bodyDir, 3, '第3章_旧名')?.name).toBe('第3章_改名后_正文.md');
    });

    it('目录里没有该章返回 undefined（调用方据此创建）', () => {
        expect(findBodyFileByChapterNum(files, bodyDir, 7)).toBeUndefined();
    });
});
