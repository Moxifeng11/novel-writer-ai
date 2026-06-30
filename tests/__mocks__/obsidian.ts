/**
 * Obsidian API Mock — 最小可行 stub
 * 模拟 Obsidian 核心类型以满足测试编译和运行时需求
 */

// === 基础类型 ===
export class Component {
    load(): void {}
    unload(): void {}
    /** 模拟 registerEvent — 子类可覆盖 */
    registerEvent(_event: any): void {}
}

export class Vault {
    private _store: Map<string, string> = new Map();
    private _folders: Set<string> = new Set();

    /** 测试辅助：种子文件（路径→内容） */
    _seedFile(path: string, content: string): TFile {
        this._store.set(path, content);
        const f = new TFile();
        f.path = path;
        f.name = path.split('/').pop() || 'unknown.md';
        f.vault = this;
        return f;
    }

    /** 测试辅助：检查文件或文件夹是否存在 */
    exists(path: string): boolean {
        // 如果是文件路径
        if (this._store.has(path)) return true;
        // 如果是文件夹路径
        return this._folders.has(path);
    }

    /** 测试辅助：写入文件 */
    async write(path: string, content: string): Promise<void> {
        this._store.set(path, content);
    }

    /** 测试辅助：读取文件（字符串路径） */
    async readByPath(path: string): Promise<string> {
        return this._store.get(path) ?? '';
    }

    /** 模拟同步缓存读取 */
    cachedRead(file: TFile): string | null {
        return this._store.get(file.path) ?? null;
    }

    /** 模拟异步文件读取（箭头函数保证 this 绑定，支持测试中替换） */
    read = async (file: TFile): Promise<string> => {
        return this._store.get(file.path) ?? '';
    };
    /** 模拟文件修改 */
    async modify(_file: TFile, _data: string): Promise<void> {}
    /** 模拟文件删除 */
    async delete(_file: TAbstractFile): Promise<void> {}
    /** 模拟文件创建 */
    async create(_path: string, _data: string): Promise<TFile> {
        this._store.set(_path, _data);
        const f = new TFile();
        f.path = _path;
        f.name = _path.split('/').pop() || 'unknown.md';
        f.vault = this;
        return f;
    }
    /** 模拟文件夹创建 */
    async createFolder(_path: string): Promise<TFolder> {
        this._folders.add(_path);
        return new TFolder();
    }
    getAbstractFileByPath(_path: string): TAbstractFile | null {
        return null;
    }
    getFiles(): TFile[] {
        return [];
    }
}

export class TAbstractFile {
    path: string = '';
    name: string = '';
    parent: TFolder | null = null;
    vault: any = new Vault();
}

export class TFile extends TAbstractFile {
    stat: { ctime: number; mtime: number; size: number } = { ctime: 0, mtime: 0, size: 0 };
    basename: string = '';
    extension: string = 'md';
}

export class TFolder extends TAbstractFile {
    children: TAbstractFile[] = [];
    isRoot(): boolean { return false; }
}

export class MetadataCache {
    getFileCache(_file: TFile): any { return null; }
    getCache(_path: string): any { return null; }
}

export class FileManager {
    async processFrontMatter(_file: TFile, _fn: (fm: any) => void): Promise<void> {}
}

export class Notice {
    constructor(_message: string | DocumentFragment, _timeout?: number) {}
}

export class App {
    vault: Vault = new Vault();
    metadataCache: MetadataCache = new MetadataCache();
    fileManager: FileManager = new FileManager();
    workspace: Workspace = new Workspace();
}

export class Workspace {
    getLeaf(_mode?: string | boolean): any { return {}; }
    getLeavesOfType(_type: string): any[] { return []; }
    revealLeaf(_leaf: any): void {}
    on(_event: string, _callback: (...args: any[]) => any): any { return { off: () => {} }; }
    trigger(_event: string, _data?: any): void {}
}

export class ItemView extends Component {
    app: App = new App();
    contentEl: HTMLElement = document.createElement('div');
    getViewType(): string { return ''; }
    getDisplayText(): string { return ''; }
    getIcon(): string { return ''; }
    async onClose(): Promise<void> { await super.unload(); }
}

export class Modal {
    app: App = new App();
    contentEl: HTMLElement = document.createElement('div');
    titleEl: HTMLElement = document.createElement('div');
    open(): void {}
    close(): void {}
    onOpen(): void {}
    onClose(): void {}
}

export class WorkspaceLeaf {
    view: ItemView = new ItemView();
}

export class MarkdownRenderer {
    static async render(
        _app: App, _markdown: string, _el: HTMLElement,
        _sourcePath: string, _component: Component,
    ): Promise<void> {}
}

export function htmlToMarkdown(_html: string): string { return ''; }
export function requestUrl(_req: any): Promise<any> { return Promise.resolve({ status: 200, json: {} }); }
export function request(_req: any): Promise<any> { return Promise.resolve({ status: 200, json: {} }); }
export function getIcon(_iconId: string): HTMLElement { return document.createElement('span'); }
export function setIcon(_el: HTMLElement, _iconId: string): void {}
export function normalizePath(_path: string): string { return _path; }
export function parseYaml(_yaml: string): any { return {}; }
export function stringifyYaml(_obj: any): string { return ''; }
