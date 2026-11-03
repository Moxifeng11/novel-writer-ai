/**
 * project-catalog.ts — 项目目录的唯一发现 / 身份判定入口
 *
 * 背景（2026-11-03）：项目列表曾有两套实现——
 *   - `ui/export-manuscript-modal.ts#listProjects`（Agent 工作台、导出、Agent 上下文）
 *   - `engine/context-manager.ts#detectProjects`（上下文采集、伏笔看板）
 * 两套判据不一致，且都把「只有 03-大纲与章节 的残留目录」当成项目：
 * 删除项目后只要有一个后台自动保存/版本备份重建该目录，Agent 就会继续显示已删除项目。
 *
 * 本模块是唯一来源：
 *   - `listProjectIds()`：三模式库 + legacy 根目录的项目列表
 *   - `isProjectDirectory()`：项目身份判据（不把空章节骨架当项目）
 *   - `projectIdentityExists()`：写入前检查项目是否仍存在，防止删后复活
 *   - `removeProjectDirectory()`：删除项目目录（含点文件），供 UI / Agent 共用
 */
import { App, TFolder } from 'obsidian';
import { MODE_LIBRARY_ROOT_LIST } from './creation-mode';
import type { FileSystemPort } from './file-system-port';

/**
 * 非项目根目录：模板、导出产物、协同草稿、资料库等。
 * 它们可能带上「03-大纲与章节」之类的子目录（模板骨架会被复制进去），
 * 不能按「有章节目录就是项目」的旧判据识别，否则会出现在项目卡里。
 */
export const NON_PROJECT_ROOTS = new Set([
    '元文件', '导出文件', '协同文件', '写作知识库', '指纹资料库',
    'deepseek-harness', 'node_modules', 'apps', 'scripts',
]);

/**
 * 项目身份标志（文件或目录）。
 *
 * 故意不包含 `03-大纲与章节`：删除项目后，残留的空章节目录/后台自动保存
 * 会把它重新建出来；它只能证明「有章节骨架」，不能证明「项目还存在」。
 */
export const PROJECT_IDENTITY_MARKERS = [
    '.project',
    '作品信息.md',
    '世界观总览.md',
    '写作配置.md',
    '00-系统模板',
    '01-世界架构',
    '短篇创作',
    '剧本创作',
] as const;

/**
 * 判断目录是否为真实项目（同步，只读 vault 索引）。
 *
 * `.project` 是点文件，Obsidian 索引通常看不到；因此真实项目必须至少有一个
 * 被索引的身份标志（作品信息/世界观/模板/世界架构/模式内容目录）。
 *
 * @param app - Obsidian 应用实例
 * @param path - 候选项目目录（vault 相对路径）
 * @returns 是否项目目录
 */
export function isProjectDirectory(app: App, path: string): boolean {
    const normalized = String(path || '').replace(/\\/g, '/').replace(/\/+$/, '');
    if (!normalized || normalized.includes('\0')) return false;
    const segments = normalized.split('/');
    const last = segments[segments.length - 1] || '';
    if (!last || last.startsWith('.') || last.startsWith('_')) return false;
    if (segments.length === 1 && NON_PROJECT_ROOTS.has(last)) return false;
    return PROJECT_IDENTITY_MARKERS.some(marker => app.vault.getAbstractFileByPath(`${normalized}/${marker}`) != null);
}

/**
 * 列出全部项目 ID（三模式库 + legacy 根目录），按路径排序。
 *
 * @param app - Obsidian 应用实例
 * @returns 项目 ID 数组
 */
export function listProjectIds(app: App): string[] {
    const projects: string[] = [];
    const root = app.vault.getRoot();
    for (const folder of root.children) {
        if (!(folder instanceof TFolder)) continue;
        if (NON_PROJECT_ROOTS.has(folder.name)) continue;
        if (folder.name.startsWith('.') || folder.name.startsWith('_')) continue;
        if (MODE_LIBRARY_ROOT_LIST.includes(folder.name)) {
            for (const child of folder.children) {
                if (!(child instanceof TFolder)) continue;
                if (NON_PROJECT_ROOTS.has(child.name)) continue;
                if (child.name.startsWith('.') || child.name.startsWith('_')) continue;
                if (isProjectDirectory(app, child.path)) projects.push(child.path);
            }
            continue;
        }
        if (isProjectDirectory(app, folder.path)) projects.push(folder.path);
    }
    return projects.sort();
}

/**
 * 从任意项目内文件路径推断项目 ID。
 *
 * - `长篇小说/书名/03-...` → `长篇小说/书名`
 * - `书名/03-...` → `书名`
 *
 * @param path - vault 相对路径
 * @returns 项目 ID；无法判断时返回空串
 */
export function projectIdFromPath(path: string): string {
    const normalized = String(path || '').replace(/\\/g, '/').replace(/^\/+/, '');
    const parts = normalized.split('/').filter(Boolean);
    if (parts.length === 0) return '';
    if (MODE_LIBRARY_ROOT_LIST.includes(parts[0])) {
        return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : '';
    }
    return parts[0];
}

/**
 * 写入保护用的强身份标志：不包含只在文件系统里存在的 `.project`。
 *
 * 删除项目时如果只残留 `.project` + 章节目录，仍应视为已删除；
 * 真实项目一定有 `作品信息.md` / 模板 / 世界架构等被索引标志。
 */
const WRITE_IDENTITY_MARKERS = PROJECT_IDENTITY_MARKERS.filter(marker => marker !== '.project');

/**
 * 写入前检查项目身份是否还存在。
 *
 * 删除项目后，打开中的协同/工作台如果还有待自动保存，会在旧路径上重建
 * `03-大纲与章节` 与 `_versions`，把已删除项目“复活”。写正文前调用本函数，
 * 缺失身份标志时抛错，由调用方提示并清理当前章节绑定。
 *
 * @param fs - 文件系统端口（支持点文件）
 * @param project - 项目 ID
 * @returns 项目是否仍然存在
 */
export async function projectIdentityExists(
    fs: Pick<FileSystemPort, 'exists'>,
    project: string,
): Promise<boolean> {
    const normalized = String(project || '').trim().replace(/\\/g, '/').replace(/\/+$/, '');
    if (!normalized) return false;
    for (const marker of WRITE_IDENTITY_MARKERS) {
        if (await fs.exists(`${normalized}/${marker}`)) return true;
    }
    return false;
}

/**
 * 递归删除项目目录（含点文件），删除后校验目录确已消失。
 *
 * @param app - Obsidian 应用实例
 * @param project - 项目 ID
 * @throws 路径非法、目标是模式库根/隐藏目录、或删除后仍存在时抛出
 */
export async function removeProjectDirectory(app: App, project: string): Promise<void> {
    const target = String(project || '').trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    const segments = target.split('/').filter(Boolean);
    if (!target || segments.length === 0 || segments.some(seg => seg === '.' || seg === '..')) {
        throw new Error(`拒绝删除非法项目路径：${JSON.stringify(project)}`);
    }
    if (/^[a-zA-Z]:/.test(target)) {
        throw new Error(`拒绝删除绝对路径：${target}`);
    }
    const last = segments[segments.length - 1];
    if (last.startsWith('.') || last.startsWith('_')) {
        throw new Error(`拒绝删除隐藏/版本目录：${target}`);
    }
    if (segments.length === 1 && MODE_LIBRARY_ROOT_LIST.includes(target)) {
        throw new Error(`拒绝删除模式库根目录：${target}`);
    }
    if (segments.length === 1 && NON_PROJECT_ROOTS.has(target)) {
        throw new Error(`拒绝删除非项目根目录：${target}`);
    }

    const adapter = app.vault.adapter;
    const removeDir = async (dirPath: string): Promise<void> => {
        const list = await adapter.list(dirPath);
        for (const file of list.files) await adapter.remove(file);
        for (const folder of list.folders) await removeDir(folder);
        await adapter.rmdir(dirPath, true);
    };
    await removeDir(target);
    if (await adapter.exists(target)) {
        throw new Error(`项目「${target}」删除后仍存在，可能有文件被占用或权限不足`);
    }
}
