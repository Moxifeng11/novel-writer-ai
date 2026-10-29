import { describe, expect, it } from 'vitest';
import type { App } from 'obsidian';
import {
    getProjectModeSync,
    modeFromPathPrefix,
    rememberProjectMode,
    resolveProjectMode,
} from '../../../shared/project-mode';

function fakeApp(meta: string | null): App {
    return {
        vault: {
            adapter: {
                exists: async () => meta !== null,
                read: async () => meta ?? '',
            },
        },
    } as unknown as App;
}

describe('project-mode — 路径前缀', () => {
    it('识别短篇/剧本/长篇目录', () => {
        expect(modeFromPathPrefix('短篇创作/我的短篇')).toBe('short');
        expect(modeFromPathPrefix('短篇小说/旧项目')).toBe('short');
        expect(modeFromPathPrefix('剧本创作/我的短剧')).toBe('script');
        expect(modeFromPathPrefix('剧本/旧剧本')).toBe('script');
        expect(modeFromPathPrefix('长篇小说/长篇')).toBe('long');
    });

    it('根目录项目无法从前缀判断', () => {
        expect(modeFromPathPrefix('根目录项目')).toBeNull();
        expect(modeFromPathPrefix('')).toBeNull();
    });

    it('同步读取优先缓存，其次前缀，读不到按 long', () => {
        expect(getProjectModeSync('短篇创作/同步测试')).toBe('short');
        expect(getProjectModeSync('根目录未知项目')).toBe('long');
        rememberProjectMode('根目录未知项目', 'script');
        expect(getProjectModeSync('根目录未知项目')).toBe('script');
    });
});

describe('project-mode — 异步解析', () => {
    it('路径前缀命中时不读 .project', async () => {
        const app = fakeApp('## 创作模式\nlong\n');
        expect(await resolveProjectMode(app, '短篇创作/前缀优先')).toBe('short');
    });

    it('根目录项目读 .project 的创作模式段', async () => {
        const app = fakeApp('## 创作模式\nscript\n\n## 目标集数\n80\n');
        expect(await resolveProjectMode(app, '根目录剧本项目-唯一')).toBe('script');
    });

    it('.project 缺失或损坏时回退 long', async () => {
        expect(await resolveProjectMode(fakeApp(null), '另一个根目录项目-唯一')).toBe('long');
        const broken = {
            vault: { adapter: { exists: async () => true, read: async () => { throw new Error('io'); } } },
        } as unknown as App;
        expect(await resolveProjectMode(broken, '损坏项目-唯一')).toBe('long');
    });

    it('解析结果写入缓存，供同步守卫复用', async () => {
        const app = fakeApp('## 创作模式\nshort\n');
        await resolveProjectMode(app, '会被缓存的项目-唯一');
        expect(getProjectModeSync('会被缓存的项目-唯一')).toBe('short');
    });
});
