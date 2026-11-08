import { describe, it, expect, afterEach } from 'vitest';
import {
    pluginDataDir,
    pluginDataFile,
    pluginPreferenceFile,
    pluginStylePatternsFile,
    pluginRootDirPath,
    pluginVersionsDir,
    setPluginRootDir,
} from '../../../shared/paths';

/**
 * 插件数据目录单源（v4.76.0）。
 *
 * 背景：Obsidian 允许用户改 `vault.configDir`，BRAT 安装的插件文件夹名也可能是
 * `obsidian-novel-writer-ai`。业务代码若硬编码 `.obsidian/plugins/novel-writer-ai`，
 * 偏好记忆 / 文笔风格学习 / 指纹库 / 版本历史 / 缓存会写到错误目录，表现为静默丢状态。
 * 这里钉住「注入后全部派生路径跟随」与「空注入不破坏兜底」。
 */
describe('插件数据目录单源', () => {
    const DEFAULT_ROOT = '.obsidian/plugins/novel-writer-ai';

    afterEach(() => {
        setPluginRootDir(DEFAULT_ROOT);
    });

    it('未注入时使用兜底根目录，所有派生路径一致', () => {
        setPluginRootDir(DEFAULT_ROOT);

        expect(pluginRootDirPath()).toBe(DEFAULT_ROOT);
        expect(pluginDataDir()).toBe(`${DEFAULT_ROOT}/data`);
        expect(pluginDataFile('usage-ledger.json')).toBe(`${DEFAULT_ROOT}/data/usage-ledger.json`);
        expect(pluginPreferenceFile('测试书')).toBe(`${DEFAULT_ROOT}/data/测试书-preferences.json`);
        expect(pluginStylePatternsFile('测试书')).toBe(`${DEFAULT_ROOT}/data/测试书-style-patterns.json`);
        expect(pluginVersionsDir()).toBe(`${DEFAULT_ROOT}/data/versions`);
    });

    it('注入自定义 configDir + 插件文件夹名后，所有派生路径跟随', () => {
        setPluginRootDir('.config/obsidian/plugins/obsidian-novel-writer-ai');

        expect(pluginRootDirPath()).toBe('.config/obsidian/plugins/obsidian-novel-writer-ai');
        expect(pluginDataDir()).toBe('.config/obsidian/plugins/obsidian-novel-writer-ai/data');
        expect(pluginDataFile('usage-ledger.json'))
            .toBe('.config/obsidian/plugins/obsidian-novel-writer-ai/data/usage-ledger.json');
        expect(pluginPreferenceFile('测试书'))
            .toBe('.config/obsidian/plugins/obsidian-novel-writer-ai/data/测试书-preferences.json');
        expect(pluginStylePatternsFile('测试书'))
            .toBe('.config/obsidian/plugins/obsidian-novel-writer-ai/data/测试书-style-patterns.json');
        expect(pluginVersionsDir())
            .toBe('.config/obsidian/plugins/obsidian-novel-writer-ai/data/versions');
    });

    it('结尾斜杠被裁剪；空值不覆盖已有根目录（防漏传参数把路径清空）', () => {
        setPluginRootDir('.config/obsidian/plugins/obsidian-novel-writer-ai/');
        expect(pluginRootDirPath()).toBe('.config/obsidian/plugins/obsidian-novel-writer-ai');

        setPluginRootDir('');
        expect(pluginRootDirPath()).toBe('.config/obsidian/plugins/obsidian-novel-writer-ai');

        setPluginRootDir('   ');
        expect(pluginRootDirPath()).toBe('.config/obsidian/plugins/obsidian-novel-writer-ai');
    });
});
