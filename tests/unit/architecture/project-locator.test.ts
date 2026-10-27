import { describe, it, expect } from 'vitest';
import {
    MODE_LIBRARY_ROOTS,
    modeFromLibraryPath,
    newProjectPath,
    projectDisplayName,
    projectFromFilePath,
    resolveProjectRoot,
} from '../../../domains/kernel/project-locator';

describe('项目定位服务', () => {
    it('定义三个独立模式库根目录', () => {
        expect(MODE_LIBRARY_ROOTS).toEqual({
            long: '长篇小说',
            short: '短篇小说',
            script: '剧本',
        });
    });

    it('识别模式库项目路径', () => {
        expect(modeFromLibraryPath('短篇小说/测试项目')).toBe('short');
        expect(modeFromLibraryPath('长篇小说/测试项目')).toBe('long');
        expect(modeFromLibraryPath('剧本/测试项目')).toBe('script');
        expect(modeFromLibraryPath('短篇小说')).toBeNull();
        expect(modeFromLibraryPath('旧项目')).toBeNull();
    });

    it('生成新项目路径并阻止斜杠注入', () => {
        expect(newProjectPath('新短篇', 'short')).toBe('短篇小说/新短篇');
        expect(newProjectPath('新剧本', 'script')).toBe('剧本/新剧本');
        expect(newProjectPath('长篇A', 'long')).toBe('长篇小说/长篇A');
        expect(newProjectPath('a/b', 'short')).toBe('短篇小说/ab');
    });

    it('显示名取模式库最后一段，legacy 保持原名', () => {
        expect(projectDisplayName('短篇小说/测试项目')).toBe('测试项目');
        expect(projectDisplayName('长篇小说/测试项目')).toBe('测试项目');
        expect(projectDisplayName('旧项目')).toBe('旧项目');
    });

    it('从文件路径推断所属项目，模式库优先最长匹配', () => {
        const candidates = ['短篇小说/测试项目', '旧项目', '元文件'];
        expect(projectFromFilePath('短篇小说/测试项目/短篇创作/03-正文/第01节.md', candidates)).toBe('短篇小说/测试项目');
        expect(projectFromFilePath('旧项目/03-大纲与章节/正文/第1卷/第1章_正文.md', candidates)).toBe('旧项目');
        expect(projectFromFilePath('元文件/模板.md', candidates)).toBe('元文件');
        expect(projectFromFilePath('无关/文件.md', candidates)).toBeNull();
    });

    it('resolveProjectRoot 保留已有库路径，可强制入库', () => {
        expect(resolveProjectRoot('短篇小说/测试项目', 'short')).toBe('短篇小说/测试项目');
        expect(resolveProjectRoot('测试项目', 'short', { requireLibrary: true })).toBe('短篇小说/测试项目');
        expect(resolveProjectRoot('测试项目')).toBe('测试项目');
    });
});
