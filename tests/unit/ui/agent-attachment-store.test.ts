import { describe, expect, it } from 'vitest';
import {
    attachmentFolderFor,
    buildAttachmentBlock,
    deleteAgentAttachment,
    isSupportedImage,
    saveAgentAttachment,
    splitAttachmentBlock,
} from '../../../ui/services/agent-attachment-store';

/** 最小 DataAdapter 替身（内存文件系统） */
function makeApp() {
    const files = new Map<string, ArrayBuffer>();
    const folders = new Set<string>();
    const adapter = {
        exists: async (path: string) => files.has(path) || folders.has(path),
        mkdir: async (path: string) => { folders.add(path); },
        writeBinary: async (path: string, data: ArrayBuffer) => { files.set(path, data); },
        remove: async (path: string) => { files.delete(path); },
        getResourcePath: (path: string) => `app://local/${path}`,
    };
    return { app: { vault: { adapter } } as never, files, folders };
}

function imageFile(name = 'shot.png', size = 4): File {
    return new File([new Uint8Array(size)], name, { type: 'image/png' });
}

describe('Agent 图片附件落盘', () => {
    it('写到 .sessions/agent/attachments/<项目>/ 并保留媒体信息', async () => {
        const { app, files } = makeApp();
        const saved = await saveAgentAttachment(app, '长篇小说/书A', imageFile());
        expect(saved.path).toMatch(/^\.sessions\/agent\/attachments\/长篇小说-书A\/shot-[a-z0-9]+\.png$/);
        expect(saved.mediaType).toBe('image/png');
        expect(saved.size).toBe(4);
        expect(files.has(saved.path)).toBe(true);
    });

    it('同名文件不覆盖，追加序号', async () => {
        const { app } = makeApp();
        const first = await saveAgentAttachment(app, '长篇小说/书A', imageFile());
        const second = await saveAgentAttachment(app, '长篇小说/书A', imageFile());
        expect(second.path).not.toBe(first.path);
    });

    it('拒绝非图片与超限图片', async () => {
        const { app } = makeApp();
        await expect(saveAgentAttachment(app, '', new File(['x'], 'a.txt', { type: 'text/plain' }))).rejects.toThrow();
        await expect(saveAgentAttachment(app, '', imageFile('big.png', 10 * 1024 * 1024 + 1))).rejects.toThrow();
        expect(isSupportedImage(new File(['x'], 'a.txt', { type: 'text/plain' }))).toBe(false);
    });

    it('删除只允许 attachments 目录下的路径', async () => {
        const { app, files } = makeApp();
        const saved = await saveAgentAttachment(app, '长篇小说/书A', imageFile());
        await deleteAgentAttachment(app, saved.path);
        expect(files.has(saved.path)).toBe(false);
        await deleteAgentAttachment(app, '长篇小说/书A/正文.md');
        expect(files.size).toBe(0);
    });

    it('附件块可拼进用户消息并从展示文本中拆出', () => {
        const block = buildAttachmentBlock([
            { path: '.sessions/agent/attachments/a/1.png', name: '1.png', mediaType: 'image/png', size: 1 },
        ]);
        expect(block).toContain('【图片附件】');
        const split = splitAttachmentBlock(`写这一段\n\n${block}`);
        expect(split.displayText).toBe('写这一段');
        expect(split.attachments).toEqual([
            { path: '.sessions/agent/attachments/a/1.png', name: '1.png' },
        ]);
        expect(attachmentFolderFor('')).toContain('/default');
    });
});
