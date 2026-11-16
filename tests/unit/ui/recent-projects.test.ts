/**
 * 最近项目排序测试（2026-11-16，B1 / H-01）
 *
 * 缺陷背景：工作台首页项目网格此前按「activeProject 优先 + 显示名 localeCompare」排序，
 * 没有使用时间记录 → 「最近使用」名不副实。
 */
import { describe, expect, it } from 'vitest';
import {
    formatRecentLabel,
    MAX_RECENT_PROJECTS,
    pruneMissingProjects,
    recordProjectOpened,
    sortProjectsByRecent,
} from '../../../ui/full-writer/recent-projects';

describe('recordProjectOpened', () => {
    it('写入时间戳', () => {
        const map: Record<string, number> = {};
        recordProjectOpened(map, '长篇小说/A', 1000);
        expect(map['长篇小说/A']).toBe(1000);
    });

    it('重复打开只更新时间', () => {
        const map: Record<string, number> = {};
        recordProjectOpened(map, 'A', 1000);
        recordProjectOpened(map, 'A', 2000);
        expect(map.A).toBe(2000);
        expect(Object.keys(map)).toHaveLength(1);
    });

    it('空项目名不写入', () => {
        const map: Record<string, number> = {};
        recordProjectOpened(map, '   ', 1000);
        expect(map).toEqual({});
    });

    it('超过上限时丢弃最旧的', () => {
        const map: Record<string, number> = {};
        for (let index = 0; index < MAX_RECENT_PROJECTS + 5; index += 1) {
            recordProjectOpened(map, `p${index}`, 1000 + index);
        }
        expect(Object.keys(map)).toHaveLength(MAX_RECENT_PROJECTS);
        expect(map.p0).toBeUndefined();
        expect(map[`p${MAX_RECENT_PROJECTS + 4}`]).toBe(1000 + MAX_RECENT_PROJECTS + 4);
    });
});

describe('sortProjectsByRecent', () => {
    it('按最近使用降序', () => {
        expect(sortProjectsByRecent(['a', 'b', 'c'], { a: 1, b: 3, c: 2 })).toEqual(['b', 'c', 'a']);
    });

    it('无记录的项目排在有记录之后，且保持传入顺序', () => {
        expect(sortProjectsByRecent(['x', 'a', 'y'], { a: 9 })).toEqual(['a', 'x', 'y']);
    });

    it('全部无记录时保持原顺序', () => {
        expect(sortProjectsByRecent(['c', 'a', 'b'], {})).toEqual(['c', 'a', 'b']);
    });

    it('映射缺失时也不报错', () => {
        expect(sortProjectsByRecent(['a', 'b'], undefined)).toEqual(['a', 'b']);
    });

    it('不修改入参数组', () => {
        const projects = ['a', 'b'];
        sortProjectsByRecent(projects, { b: 1 });
        expect(projects).toEqual(['a', 'b']);
    });
});

describe('formatRecentLabel', () => {
    const now = 1_700_000_000_000;

    it('一分钟内为「刚刚」', () => {
        expect(formatRecentLabel(now - 30_000, now)).toBe('刚刚');
    });

    it('分钟 / 小时 / 天', () => {
        expect(formatRecentLabel(now - 3 * 60_000, now)).toBe('3 分钟前');
        expect(formatRecentLabel(now - 5 * 3_600_000, now)).toBe('5 小时前');
        expect(formatRecentLabel(now - 2 * 86_400_000, now)).toBe('2 天前');
    });

    it('超过一周显示日期', () => {
        const label = formatRecentLabel(now - 10 * 86_400_000, now);
        expect(label).toMatch(/月.*日/);
    });

    it('无有效时间戳返回空串', () => {
        expect(formatRecentLabel(undefined, now)).toBe('');
        expect(formatRecentLabel(0, now)).toBe('');
    });
});

describe('pruneMissingProjects（幽灵记录清理）', () => {
    it('移除已不存在的项目', () => {
        const result = pruneMissingProjects({ gone: 1, kept: 2 }, ['kept']);
        expect(result.changed).toBe(true);
        expect(result.map).toEqual({ kept: 2 });
    });

    it('无幽灵项时不标记变化并返回原引用', () => {
        const map = { kept: 2 };
        const result = pruneMissingProjects(map, ['kept']);
        expect(result.changed).toBe(false);
        expect(result.map).toBe(map);
    });

    it('映射缺失时安全返回', () => {
        const result = pruneMissingProjects(undefined, ['a']);
        expect(result.changed).toBe(false);
        expect(result.map).toEqual({});
    });

    it('全部失效时清空', () => {
        const result = pruneMissingProjects({ a: 1, b: 2 }, []);
        expect(result.changed).toBe(true);
        expect(result.map).toEqual({});
    });
});

