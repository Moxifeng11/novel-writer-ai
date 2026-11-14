/**
 * FileTxService 非 Markdown 事务测试
 *
 * 覆盖「版本内容 + versions.json 一起提交」的数据安全路径：
 * 正常时两份都落盘；中途失败时已写的文件回滚到原状态。
 */

import { describe, expect, it } from 'vitest';
import { App, Vault } from 'obsidian';
import { FileTxService } from '@/services/file-tx';

/** 构造带 mock vault 的 App。 */
interface MockVault extends Vault {
    _seedFile(path: string, content: string): unknown;
}

const makeApp = (): { app: App; vault: MockVault } => {
    const vault = new Vault() as MockVault;
    const app = new App();
    app.vault = vault;
    return { app, vault };
};

describe('FileTxService · 非 Markdown 事务', () => {
    it('两份 JSON 一起提交', async () => {
        const { app, vault } = makeApp();
        const service = new FileTxService(app);
        await service.run('长篇小说/书A', [
            { path: '长篇小说/书A/04-项目总控/版本/第01章/v1.json', content: '{"v":1}' },
            { path: '长篇小说/书A/04-项目总控/版本/第01章/versions.json', content: '{"latest":1}' },
        ]);
        expect(await vault.adapter.read('长篇小说/书A/04-项目总控/版本/第01章/v1.json')).toBe('{"v":1}');
        expect(await vault.adapter.read('长篇小说/书A/04-项目总控/版本/第01章/versions.json')).toBe('{"latest":1}');
    });

    it('第二份写入失败时，第一份回滚且不残留事务日志', async () => {
        const { app, vault } = makeApp();
        // 让第二个路径写入抛错
        const originalWrite = vault.adapter.write.bind(vault.adapter);
        let calls = 0;
        vault.adapter.write = async (path: string, data: string) => {
            calls += 1;
            if (path.endsWith('versions.json')) throw new Error('模拟磁盘写失败');
            return originalWrite(path, data);
        };
        const service = new FileTxService(app);
        await expect(service.run('长篇小说/书A', [
            { path: '长篇小说/书A/04-项目总控/版本/第01章/v1.json', content: '{"v":1}' },
            { path: '长篇小说/书A/04-项目总控/版本/第01章/versions.json', content: '{"latest":1}' },
        ])).rejects.toThrow('模拟磁盘写失败');
        // 第一份已写内容被回滚删除（原来不存在）
        expect(await vault.adapter.exists('长篇小说/书A/04-项目总控/版本/第01章/v1.json')).toBe(false);
        expect(calls).toBeGreaterThan(0);
    });

    it('失败时恢复被覆盖文件的旧内容', async () => {
        const { app, vault } = makeApp();
        vault._seedFile('长篇小说/书A/04-项目总控/版本/第01章/v1.json', '{"old":true}');
        const originalWrite = vault.adapter.write.bind(vault.adapter);
        vault.adapter.write = async (path: string, data: string) => {
            if (path.endsWith('versions.json')) throw new Error('模拟失败');
            return originalWrite(path, data);
        };
        const service = new FileTxService(app);
        await expect(service.run('长篇小说/书A', [
            { path: '长篇小说/书A/04-项目总控/版本/第01章/v1.json', content: '{"new":true}' },
            { path: '长篇小说/书A/04-项目总控/版本/第01章/versions.json', content: '{}' },
        ])).rejects.toThrow();
        expect(await vault.adapter.read('长篇小说/书A/04-项目总控/版本/第01章/v1.json')).toBe('{"old":true}');
    });
});
