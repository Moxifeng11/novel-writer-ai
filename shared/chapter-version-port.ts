/**
 * chapter-version-port.ts — 章节版本保存端口
 *
 * core 层不允许依赖 services。命令注册表保存当前版本时只需要 saveVersion 的签名，
 * 因此由 shared 定义端口接口，core 只拿端口类型，具体实现仍由 ChapterVersionService 注入。
 */

import type { ContentType, VersionMeta, VersionType } from './version-types';

export interface ChapterVersionPort {
    saveVersion(
        project: string,
        contentType: ContentType,
        contentKey: string,
        sourcePath: string,
        content: string,
        options: { type: VersionType; tags?: string[]; note?: string },
    ): Promise<VersionMeta>;
}
