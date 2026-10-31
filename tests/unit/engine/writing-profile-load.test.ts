import { describe, expect, it } from 'vitest';
import { WritingProfileManager } from '../../../engine/writing-profile';
import { MockFileSystem } from '../../../shared/file-system-port';

const app = {} as never;
const project = '长篇小说/测试书';
const configPath = `${project}/写作配置.md`;

describe('WritingProfileManager — 解析失败不覆盖用户配置（P1-10）', () => {
    it('文件不存在时用默认值，保存不产生 .bak', async () => {
        const fs = new MockFileSystem();
        const manager = new WritingProfileManager(app, fs as never);
        const profile = await manager.load(project);
        expect(profile).toBeTruthy();
        await manager.save(project, profile);
        expect(await fs.exists(configPath)).toBe(true);
        const listed = await fs.listFiles(project).catch(() => []);
        expect(listed.some((f) => f.name.includes('.bak-'))).toBe(false);
    });

    it('解析失败时首次保存先留档原文件', async () => {
        const fs = new MockFileSystem();
        // 非法 YAML/结构 → parseProfile 抛错
        fs.setFile(configPath, '这不是合法的配置内容 {{{');
        const manager = new WritingProfileManager(app, fs as never);
        const profile = await manager.load(project);
        expect(profile).toBeTruthy();
        await manager.save(project, profile);

        const files = await fs.listFiles(project);
        const backup = files.find((f) => f.name.includes('.bak-'));
        expect(backup).toBeTruthy();
        expect(await fs.read(backup!.path)).toContain('这不是合法的配置内容');
    });
});
