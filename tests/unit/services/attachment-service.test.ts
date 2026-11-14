/**
 * 附件服务与工具测试
 */

import { describe, expect, it } from 'vitest';
import { App, Vault } from 'obsidian';
import { AttachmentService } from '@/services/attachment-service';

/** 构造带 mock vault 的 App。 */
const makeService = (): { service: AttachmentService; vault: Vault } => {
    const vault = new Vault();
    const app = new App();
    app.vault = vault;
    return { service: new AttachmentService(app), vault };
};

describe('AttachmentService', () => {
    it('保存附件到项目目录', async () => {
        const { service } = makeService();
        const result = await service.save('长篇小说/书A', '参考图.png', new ArrayBuffer(8));
        expect(result.error).toBeUndefined();
        expect(result.path).toContain('04-项目总控/附件/');
        expect(result.path.endsWith('.png')).toBe(true);
    });

    it('不支持的附件类型被拒绝', async () => {
        const { service } = makeService();
        const result = await service.save('长篇小说/书A', 'a.exe', new ArrayBuffer(1));
        expect(result.error).toContain('不支持');
    });

    it('无项目时拒绝保存', async () => {
        const { service } = makeService();
        expect((await service.save('', 'a.png', new ArrayBuffer(1))).error).toContain('请先打开一个项目');
    });

    it('读取不存在的附件返回 null', async () => {
        const { service } = makeService();
        expect(await service.read('nope/a.png')).toBeNull();
    });

    it('无附件目录时列表为空', () => {
        const { service } = makeService();
        expect(service.list('长篇小说/空项目')).toEqual([]);
    });
});
