/**
 * file-system-port.ts — 文件系统抽象接口
 *
 * 目的：将 engine 层与 Obsidian 平台解耦，实现真正的关注点分离。
 *
 * 背景：
 * - engine/ 目录中 18 个文件直接导入 obsidian 并操作 app.vault
 * - 这违反了分层架构原则，导致难以测试、难以复用、难以迁移
 *
 * 使用方式：
 * 1. engine/ 的类/函数接收 FileSystemPort 参数，而非直接使用 app
 * 2. UI 层创建 ObsidianFileSystem 实例并传给 engine 层
 * 3. 测试时可以使用 MockFileSystem 进行单元测试
 *
 * 示例：
 * ```typescript
 * // 之前（违反分层）
 * constructor(private plugin: NovelWriterPlugin) {
 *     this.app = plugin.app;
 * }
 *
 * // 之后（遵循分层）
 * constructor(private fs: FileSystemPort, private app: App) {
 * }
 * ```
 */

import { TFile, TFolder } from 'obsidian';

/**
 * 文件系统操作接口
 * 封装文件系统的基本操作，使 engine 层无需依赖具体平台
 */
export interface FileSystemPort {
    // ── 文件操作 ──────────────────────────────────────────────
    /** 读取文件内容 */
    read(path: string): Promise<string>;
    /** 写入文件（已存在则覆盖） */
    write(path: string, content: string): Promise<void>;
    /** 检查文件是否存在 */
    exists(path: string): Promise<boolean>;
    /** 获取文件元数据（不存在返回 null） */
    getFile(path: string): Promise<TFile | null>;
    /** 获取文件夹元数据（不存在返回 null） */
    getFolder(path: string): Promise<TFolder | null>;
    /** 列出目录下的所有文件（递归） */
    listFiles(dirPath: string): Promise<TFile[]>;
    /** 列出目录下的所有文件夹（递归） */
    listFolders(dirPath: string): Promise<TFolder[]>;
    /** 创建目录（递归） */
    mkdir(dirPath: string): Promise<void>;
    /** 获取目录下所有条目 */
    listAll(dirPath: string): Promise<Array<TFile | TFolder>>;
    /** 删除文件或目录 */
    delete(path: string): Promise<void>;
    /** 重命名/移动文件 */
    rename(oldPath: string, newPath: string): Promise<void>;
}

/**
 * Frontmatter 操作接口
 * 封装 Obsidian 的 frontmatter 处理
 */
export interface FrontmatterPort {
    /** 处理文件的 frontmatter（原子操作） */
    processFrontmatter(file: TFile, updater: (fm: Record<string, unknown>) => void): Promise<void>;
}

/**
 * Vault 元数据接口
 * 封装 vault 的元数据查询
 */
export interface VaultMetaPort {
    /** 获取所有文件 */
    getFiles(): TFile[];
    /** 获取所有文件夹 */
    getFolders(): TFolder[];
    /** 根据路径获取抽象文件 */
    getAbstractFileByPath(path: string): TFile | TFolder | null;
}

/**
 * Obsidian 平台适配器
 * 实现 FileSystemPort 接口，封装 Obsidian 的文件系统操作
 */
export class ObsidianFileSystem implements FileSystemPort {
    constructor(
        private app: import('obsidian').App,
    ) {}

    /**
     * 路径是否位于 Obsidian 配置目录（如 `.obsidian/plugins/<id>/data`）。
     * vault 索引只覆盖用户 vault：配置目录里的文件 getAbstractFileByPath 恒为 null、
     * getFiles 也列不出来，必须回退到 vault.adapter 才能读写。
     */
    private isUnderConfigDir(path: string): boolean {
        const configDir = this.app.vault.configDir;
        return path === configDir || path.startsWith(`${configDir}/`);
    }

    private async adapterExists(path: string): Promise<boolean> {
        try {
            return await this.app.vault.adapter.exists(path);
        } catch {
            return false;
        }
    }

    async read(path: string): Promise<string> {
        const file = this.app.vault.getAbstractFileByPath(path);
        if (file instanceof TFile) {
            return await this.app.vault.read(file);
        }
        if (await this.adapterExists(path)) {
            return await this.app.vault.adapter.read(path);
        }
        throw new Error(`File not found: ${path}`);
    }

    async write(path: string, content: string): Promise<void> {
        const existing = this.app.vault.getAbstractFileByPath(path);
        if (existing instanceof TFile) {
            await this.app.vault.modify(existing, content);
        } else if (existing) {
            throw new Error(`Path is a folder, not a file: ${path}`);
        } else if (this.isUnderConfigDir(path) || await this.adapterExists(path)) {
            // 配置目录（插件数据）不在索引里，vault.create 建不出来；
            // 索引外的已存在文件同样只能走 adapter。
            await this.app.vault.adapter.write(path, content);
        } else {
            await this.app.vault.create(path, content);
        }
    }

    async exists(path: string): Promise<boolean> {
        if (this.app.vault.getAbstractFileByPath(path) !== null) return true;
        return this.adapterExists(path);
    }

    async getFile(path: string): Promise<TFile | null> {
        const file = this.app.vault.getAbstractFileByPath(path);
        return file instanceof TFile ? file : null;
    }

    async getFolder(path: string): Promise<TFolder | null> {
        const folder = this.app.vault.getAbstractFileByPath(path);
        return folder instanceof TFolder ? folder : null;
    }

    async listFiles(dirPath: string): Promise<TFile[]> {
        const folder = await this.getFolder(dirPath);
        if (!folder) {
            // 配置目录不在索引里：用 adapter 递归列文件，构造只含调用方所需字段的 TFile 形状对象。
            const paths = await this.listAdapterFiles(dirPath);
            const files: TFile[] = [];
            for (const path of paths) files.push(await this.toVirtualFile(path));
            return files;
        }
        return this.app.vault.getFiles().filter(f => f.path.startsWith(dirPath + '/'));
    }

    async listFolders(dirPath: string): Promise<TFolder[]> {
        const folder = await this.getFolder(dirPath);
        if (!folder) return this.listAdapterFolders(dirPath);
        return this.app.vault.getAllFolders().filter((f: TFolder) => f.path.startsWith(dirPath + '/') && f.path !== dirPath);
    }

    private async listAdapterFiles(dirPath: string): Promise<string[]> {
        const entries = await this.app.vault.adapter.list(dirPath).catch(() => null);
        if (!entries) return [];
        const result = [...entries.files];
        for (const sub of entries.folders) {
            result.push(...(await this.listAdapterFiles(sub)));
        }
        return result;
    }

    private async listAdapterFolders(dirPath: string): Promise<TFolder[]> {
        const entries = await this.app.vault.adapter.list(dirPath).catch(() => null);
        if (!entries) return [];
        const result: TFolder[] = [];
        for (const sub of entries.folders) {
            result.push(this.toVirtualFolder(sub));
            result.push(...(await this.listAdapterFolders(sub)));
        }
        return result;
    }

    private async toVirtualFile(path: string): Promise<TFile> {
        const stat = await this.app.vault.adapter.stat(path).catch(() => null);
        const name = path.split('/').pop() ?? path;
        const dot = name.lastIndexOf('.');
        return {
            path,
            name,
            basename: dot > 0 ? name.slice(0, dot) : name,
            extension: dot > 0 ? name.slice(dot + 1) : '',
            stat: {
                ctime: stat?.ctime ?? 0,
                mtime: stat?.mtime ?? 0,
                size: stat?.size ?? 0,
            },
        } as unknown as TFile;
    }

    private toVirtualFolder(path: string): TFolder {
        return {
            path,
            name: path.split('/').pop() ?? path,
            children: [],
        } as unknown as TFolder;
    }

    async mkdir(dirPath: string): Promise<void> {
        const folders = dirPath.split('/').filter(Boolean);
        let currentPath = '';
        for (const folderName of folders) {
            currentPath = currentPath ? `${currentPath}/${folderName}` : folderName;
            if (this.isUnderConfigDir(currentPath)) {
                // 配置目录不在索引里，vault.createFolder 建不出来；adapter.mkdir 对已存在目录会抛错，忽略。
                if (!(await this.adapterExists(currentPath))) {
                    await this.app.vault.adapter.mkdir(currentPath).catch(() => undefined);
                }
                continue;
            }
            const existing = this.app.vault.getAbstractFileByPath(currentPath);
            if (!existing) {
                try {
                    await this.app.vault.createFolder(currentPath);
                } catch (e) {
                    if (e instanceof Error && (e.message.includes('Folder already exists') || e.message.includes('already exists'))) {
                        continue;
                    }
                    throw e;
                }
            }
        }
    }

    async listAll(dirPath: string): Promise<Array<TFile | TFolder>> {
        const files = await this.listFiles(dirPath);
        const folders = await this.listFolders(dirPath);
        return [...files, ...folders];
    }

    async delete(path: string): Promise<void> {
        const file = this.app.vault.getAbstractFileByPath(path);
        if (file) {
            if (file instanceof TFolder) {
                await this.app.vault.delete(file, true);
            } else {
                await this.app.vault.delete(file);
            }
            return;
        }
        // 索引外路径（插件数据目录）：adapter 直接删，不存在则静默返回。
        const stat = await this.app.vault.adapter.stat(path).catch(() => null);
        if (!stat) return;
        if (stat.type === 'folder') {
            await this.app.vault.adapter.rmdir(path, true);
        } else {
            await this.app.vault.adapter.remove(path);
        }
    }

    async rename(oldPath: string, newPath: string): Promise<void> {
        await this.app.vault.adapter.rename(oldPath, newPath);
    }
}

/**
 * Obsidian Frontmatter 适配器
 */
export class ObsidianFrontmatter implements FrontmatterPort {
    constructor(
        private app: import('obsidian').App,
    ) {}

    async processFrontmatter(file: TFile, updater: (fm: Record<string, unknown>) => void): Promise<void> {
        await this.app.fileManager.processFrontMatter(file, updater);
    }
}

/**
 * Obsidian Vault 元数据适配器
 */
export class ObsidianVaultMeta implements VaultMetaPort {
    constructor(
        private app: import('obsidian').App,
    ) {}

    getFiles(): TFile[] {
        return this.app.vault.getFiles();
    }

    getFolders(): TFolder[] {
        return this.app.vault.getAllFolders();
    }

    getAbstractFileByPath(path: string): TFile | TFolder | null {
        const file = this.app.vault.getAbstractFileByPath(path);
        if (file instanceof TFile || file instanceof TFolder) {
            return file;
        }
        return null;
    }
}

/**
 * Mock 文件系统（用于测试）
 * 同时实现 FileSystemPort 和 VaultMetaPort 接口
 */
export class MockFileSystem implements FileSystemPort, VaultMetaPort {
    private files: Map<string, string> = new Map();
    private folders: Set<string> = new Set();

    private toTFile(path: string): TFile {
        return { path, name: path.split('/').pop() || '' } as unknown as TFile;
    }

    private toTFolder(path: string): TFolder {
        return { path, name: path.split('/').pop() || '' } as unknown as TFolder;
    }

    async read(path: string): Promise<string> {
        const content = this.files.get(path);
        if (content === undefined) {
            throw new Error(`File not found: ${path}`);
        }
        return content;
    }

    async write(path: string, content: string): Promise<void> {
        this.files.set(path, content);
    }

    async exists(path: string): Promise<boolean> {
        return this.files.has(path) || this.folders.has(path);
    }

    async getFile(path: string): Promise<TFile | null> {
        if (this.files.has(path)) {
            return this.toTFile(path);
        }
        return null;
    }

    async getFolder(path: string): Promise<TFolder | null> {
        if (this.folders.has(path)) {
            return this.toTFolder(path);
        }
        return null;
    }

    async listFiles(dirPath: string): Promise<TFile[]> {
        return Array.from(this.files.keys())
            .filter(p => dirPath === '' ? true : p.startsWith(dirPath + '/'))
            .map(p => this.toTFile(p));
    }

    async listFolders(dirPath: string): Promise<TFolder[]> {
        const subFolders = new Set<string>();
        for (const path of this.folders) {
            if (dirPath === '' ? true : (path.startsWith(dirPath + '/') && path !== dirPath)) {
                subFolders.add(path);
            }
        }
        return Array.from(subFolders).map(p => this.toTFolder(p));
    }

    async mkdir(dirPath: string): Promise<void> {
        this.folders.add(dirPath);
    }

    async listAll(dirPath: string): Promise<Array<TFile | TFolder>> {
        return [...(await this.listFiles(dirPath)), ...(await this.listFolders(dirPath))];
    }

    async delete(path: string): Promise<void> {
        this.files.delete(path);
        this.folders.delete(path);
        const prefix = path + '/';
        for (const filePath of Array.from(this.files.keys())) {
            if (filePath.startsWith(prefix)) {
                this.files.delete(filePath);
            }
        }
        for (const folderPath of Array.from(this.folders)) {
            if (folderPath.startsWith(prefix)) {
                this.folders.delete(folderPath);
            }
        }
    }

    async rename(oldPath: string, newPath: string): Promise<void> {
        if (this.files.has(oldPath)) {
            const content = this.files.get(oldPath)!;
            this.files.delete(oldPath);
            this.files.set(newPath, content);
        }
        if (this.folders.has(oldPath)) {
            this.folders.delete(oldPath);
            this.folders.add(newPath);
        }
    }

    getFiles(): TFile[] {
        return Array.from(this.files.keys()).map(p => this.toTFile(p));
    }

    getFolders(): TFolder[] {
        return Array.from(this.folders).map(p => this.toTFolder(p));
    }

    getAbstractFileByPath(path: string): TFile | TFolder | null {
        if (this.files.has(path)) {
            return this.toTFile(path);
        }
        if (this.folders.has(path)) {
            return this.toTFolder(path);
        }
        return null;
    }

    /** 辅助方法：预设文件内容 */
    setFile(path: string, content: string): void {
        this.files.set(path, content);
    }

    /** 辅助方法：预设文件夹 */
    setFolder(path: string): void {
        this.folders.add(path);
    }

    /** 辅助方法：清空所有数据 */
    clear(): void {
        this.files.clear();
        this.folders.clear();
    }
}
