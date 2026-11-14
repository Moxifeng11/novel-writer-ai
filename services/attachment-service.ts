/**
 * attachment-service.ts — 附件落盘与读取
 *
 * 存储：<项目>/04-项目总控/附件/<时间戳>-<安全名>
 * 文本类附件可直接读出正文；图片/文档只返回元信息（由上层决定是否走多模态）。
 */

import { App, TFile } from 'obsidian';
import { createLogger } from '@/shared/logger';
import { pjAttachmentDir } from '@/shared/paths';
import {
    attachmentKind,
    isSupportedAttachment,
    safeAttachmentName,
    type AttachmentKind,
} from '@/shared/attachment-model';

const log = createLogger('AttachmentService');

/** 附件读取结果 */
export interface AttachmentReadResult {
    /** 附件路径 */
    path: string;
    /** 分类 */
    kind: AttachmentKind;
    /** 文本内容（仅 text 类） */
    text?: string;
    /** 字节数 */
    size: number;
}

/**
 * 附件服务。
 */
export class AttachmentService {
    /**
     * @param app - Obsidian 应用
     */
    constructor(private readonly app: App) {}

    /**
     * 保存附件。
     *
     * @param project - 项目路径
     * @param name - 原始文件名
     * @param data - 文件内容
     * @returns 附件 vault 路径
     */
    async save(project: string, name: string, data: ArrayBuffer): Promise<{ path: string; error?: string }> {
        if (!isSupportedAttachment(name)) return { path: '', error: '不支持的附件类型' };
        if (!project) return { path: '', error: '请先打开一个项目' };
        const dir = pjAttachmentDir(project);
        try {
            if (!this.app.vault.getAbstractFileByPath(dir)) {
                await this.app.vault.createFolder(dir);
            }
            const path = `${dir}/${safeAttachmentName(name)}`;
            await this.app.vault.createBinary(path, data);
            return { path };
        } catch (error) {
            log.warn('附件保存失败:', error);
            return { path: '', error: error instanceof Error ? error.message : String(error) };
        }
    }

    /**
     * 读取附件（文本类返回正文）。
     *
     * @param path - 附件路径
     * @returns 读取结果或 null
     */
    async read(path: string): Promise<AttachmentReadResult | null> {
        const file = this.app.vault.getAbstractFileByPath(String(path || '').trim());
        if (!(file instanceof TFile)) return null;
        const kind = attachmentKind(file.path);
        const size = file.stat?.size ?? 0;
        if (kind !== 'text') return { path: file.path, kind, size };
        try {
            return { path: file.path, kind, size, text: await this.app.vault.read(file) };
        } catch (error) {
            // silent-ok: 文本附件读失败按「无正文」返回元信息，不阻断会话
            log.warn('附件读取失败:', file.path, error);
            return { path: file.path, kind, size };
        }
    }

    /**
     * 列出项目附件。
     *
     * @param project - 项目路径
     * @returns 附件路径
     */
    list(project: string): string[] {
        const dir = this.app.vault.getAbstractFileByPath(pjAttachmentDir(project));
        if (!dir || !('children' in dir)) return [];
        return (dir as { children: Array<{ path: string }> }).children
            .map(child => child.path)
            .filter(path => isSupportedAttachment(path))
            .sort();
    }
}
