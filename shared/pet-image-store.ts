/**
 * pet-image-store.ts — 本机桌宠图片的磁盘持久化（图 + 元数据）
 *
 * 背景：图片以 base64 data URL 存在 settings（data.json）里时有两个现实问题：
 * - 每次保存设置都要重写几百 KB 的 JSON，慢且容易被外部同步工具截断；
 * - 任何把 petImage 当陌生字段丢掉/重置的路径（旧版迁移、重置设置、手工改 data.json）
 *   都会让用户「重载后又要重选图片」。
 *
 * 因此本机图片改为**独立文件**存放：`<插件目录>/pet-image.png` + `pet-image.json`
 * （cols/rows/source）。settings 里只留元数据，启动时由 `loadPetImageFromDisk`
 * 把图片读回内存；即使 settings 丢字段，也能从文件恢复。
 */

import type { App } from 'obsidian';
import { pluginRootDirPath } from './paths';
import { normalizePetImageConfig, type PetImageConfig } from './pet-image-model';

/** 图片文件名 */
export const PET_IMAGE_FILE_NAME = 'pet-image.png';
/** 元数据文件名 */
export const PET_IMAGE_META_NAME = 'pet-image.json';

/** 元数据文件结构 */
export interface PetImageMeta {
    version: 1;
    /** 来源（目前只持久化 file；vault 由 settings.path 直接引用仓库文件） */
    source: 'file' | 'vault';
    path?: string;
    cols: number;
    rows: number;
}

/** 最小 adapter 形状（便于测试注入） */
export interface PetImageStoreAdapter {
    exists?(path: string): Promise<boolean> | boolean;
    read?(path: string): Promise<string>;
    write?(path: string, data: string): Promise<void>;
    writeBinary?(path: string, data: ArrayBuffer): Promise<void>;
    readBinary?(path: string): Promise<ArrayBuffer>;
    mkdir?(path: string): Promise<void>;
}

/**
 * data URL → 二进制。
 *
 * @param dataUrl - 图片 data URL
 * @returns 字节；非法/非图片返回 null
 * @example
 * dataUrlToBytes('data:image/png;base64,AAAA'); // Uint8Array
 */
export function dataUrlToBytes(dataUrl: string): Uint8Array | null {
    const match = /^data:image\/(png|jpe?g|webp|gif);base64,([A-Za-z0-9+/=]+)$/i.exec(String(dataUrl || '').trim());
    if (!match) return null;
    try {
        const binary = atob(match[2]);
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
        return bytes;
    } catch { // silent-ok: 非法 base64 按无效图片处理
        return null;
    }
}

/**
 * 二进制 → PNG data URL。
 *
 * @param bytes - 图片字节
 * @returns PNG data URL
 * @example
 * bytesToPngDataUrl(new Uint8Array([1, 2])); // 'data:image/png;base64,...'
 */
export function bytesToPngDataUrl(bytes: ArrayBuffer | Uint8Array): string {
    const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    let binary = '';
    const chunk = 0x8000;
    for (let index = 0; index < view.length; index += chunk) {
        binary += String.fromCharCode(...view.subarray(index, index + chunk));
    }
    return `data:image/png;base64,${btoa(binary)}`;
}

/**
 * 图片文件路径（vault 相对）。
 *
 * @returns 插件目录下的 pet-image.png 路径
 * @example
 * petImageFilePath(); // '.obsidian/plugins/novel-writer-ai/pet-image.png'
 */
export function petImageFilePath(): string {
    return `${pluginRootDirPath()}/${PET_IMAGE_FILE_NAME}`;
}

/**
 * 元数据文件路径（vault 相对）。
 *
 * @returns 插件目录下的 pet-image.json 路径
 * @example
 * petImageMetaPath(); // '.obsidian/plugins/novel-writer-ai/pet-image.json'
 */
export function petImageMetaPath(): string {
    return `${pluginRootDirPath()}/${PET_IMAGE_META_NAME}`;
}

/**
 * 元数据 JSON 解析（损坏返回 null）。
 *
 * @param raw - 元数据文件内容
 * @returns 解析结果；损坏/非法返回 null
 * @example
 * parsePetImageMeta('{"source":"file","cols":2,"rows":2}')?.cols; // 2
 */
export function parsePetImageMeta(raw: string): PetImageMeta | null {
    try {
        const parsed = JSON.parse(raw) as Partial<PetImageMeta>;
        const cols = Number(parsed.cols);
        const rows = Number(parsed.rows);
        if (parsed.source !== 'file' && parsed.source !== 'vault') return null;
        if (!Number.isFinite(cols) || !Number.isFinite(rows)) return null;
        return {
            version: 1,
            source: parsed.source,
            path: typeof parsed.path === 'string' ? parsed.path : undefined,
            cols: Math.max(1, Math.min(8, Math.floor(cols))),
            rows: Math.max(1, Math.min(8, Math.floor(rows))),
        };
    } catch { // silent-ok: 元数据损坏按无持久化图片处理（回落到内置形象）
        return null;
    }
}

/**
 * 把本机图片写到插件目录（图片 + 元数据）。
 *
 * @param app - Obsidian 应用
 * @param dataUrl - 图片 data URL
 * @param grid - 网格
 * @returns 是否成功（失败不抛错，调用方提示用户）
 */
export async function savePetImageToDisk(
    app: App,
    dataUrl: string,
    grid: { cols: number; rows: number },
): Promise<boolean> {
    const adapter = (app?.vault?.adapter ?? null) as PetImageStoreAdapter | null;
    if (!adapter) return false;
    const bytes = dataUrlToBytes(dataUrl);
    if (!bytes) return false;
    const meta: PetImageMeta = {
        version: 1,
        source: 'file',
        cols: Math.max(1, Math.min(8, Math.floor(grid.cols))),
        rows: Math.max(1, Math.min(8, Math.floor(grid.rows))),
    };
    try {
        if (typeof adapter.writeBinary === 'function') {
            await adapter.writeBinary(petImageFilePath(), bytes.buffer as ArrayBuffer); // write-entry-allow: 桌宠图片是插件目录索引外二进制资源，不进 vault 索引
        } else if (typeof adapter.write === 'function') {
            // 移动端/受限 adapter：退回 base64 文本（读取时同路径）
            await adapter.write(petImageFilePath(), bytesToPngDataUrl(bytes)); // write-entry-allow: 同上，插件目录索引外图片
        } else {
            return false;
        }
        if (typeof adapter.write === 'function') {
            await adapter.write(petImageMetaPath(), JSON.stringify(meta, null, 2)); // write-entry-allow: 桌宠图片元数据，插件目录索引外 JSON
        }
        return true;
    } catch { // silent-ok: 写盘失败由调用方提示；settings 仍会保留元数据供下次重试
        return false;
    }
}

/**
 * 从插件目录读回本机图片（图片 + 元数据 → 配置）。
 *
 * @param app - Obsidian 应用
 * @returns 配置；没有/损坏返回 null
 */
export async function loadPetImageFromDisk(app: App): Promise<PetImageConfig | null> {
    const adapter = (app?.vault?.adapter ?? null) as PetImageStoreAdapter | null;
    if (!adapter) return null;
    try {
        const exists = async (path: string): Promise<boolean> => {
            try {
                return Boolean(await adapter.exists?.(path));
            } catch { // silent-ok: 存在性探测失败按不存在处理
                return false;
            }
        };
        if (!(await exists(petImageFilePath())) || !(await exists(petImageMetaPath()))) return null;
        const metaRaw = typeof adapter.read === 'function' ? await adapter.read(petImageMetaPath()) : '';
        const meta = parsePetImageMeta(metaRaw);
        if (!meta) return null;
        let dataUrl = '';
        if (typeof adapter.readBinary === 'function') {
            const binary = await adapter.readBinary(petImageFilePath());
            dataUrl = bytesToPngDataUrl(binary);
        } else if (typeof adapter.read === 'function') {
            const text = await adapter.read(petImageFilePath());
            dataUrl = text.trim().startsWith('data:image/') ? text.trim() : '';
        }
        if (!dataUrl) return null;
        return normalizePetImageConfig({ source: 'file', dataUrl, cols: meta.cols, rows: meta.rows });
    } catch { // silent-ok: 读盘失败按无持久化图片处理（回落到内置形象）
        return null;
    }
}

/**
 * 清除磁盘上的桌宠图片与元数据（用户恢复内置形象时调用）。
 *
 * @param app - Obsidian 应用
 * @returns 是否清理成功
 */
export async function clearPetImageFromDisk(app: App): Promise<boolean> {
    const adapter = (app?.vault?.adapter ?? null) as PetImageStoreAdapter | null;
    if (!adapter || typeof adapter.write !== 'function') return false;
    const removable = adapter as unknown as { remove?(path: string): Promise<void> };
    if (typeof removable.remove !== 'function') return false;
    try {
        for (const path of [petImageFilePath(), petImageMetaPath()]) {
            try {
                await removable.remove(path);
            } catch { // silent-ok: 文件不存在时忽略
            }
        }
        return true;
    } catch { // silent-ok: 清理失败不影响切回内置形象
        return false;
    }
}
