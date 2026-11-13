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
    configDir = '.obsidian';
    private _store: Map<string, string> = new Map();
    private _folders: Set<string> = new Set();
    adapter: DataAdapter;

    constructor() {
        this.adapter = new DataAdapter(this._store, this._folders);
    }

    /** 测试辅助：种子文件（路径→内容） */
    _seedFile(path: string, content: string): TFile {
        this._store.set(path, content);
        // 自动登记祖先目录：否则 getAbstractFileByPath 找不到目录，
        // 基于目录遍历的实现（listFolderFiles）在测试里会恒为空。
        const parts = path.split('/');
        for (let i = 1; i < parts.length; i++) {
            this._folders.add(parts.slice(0, i).join('/'));
        }
        const f = new TFile();
        f.path = path;
        f.name = path.split('/').pop() || 'unknown.md';
        f.basename = f.name.replace(/\.[^/.]+$/, '');
        f.extension = f.name.includes('.') ? f.name.split('.').pop() || '' : '';
        f.vault = this;
        f.stat.size = content.length;
        return f;
    }

    /** 测试辅助：检查文件或文件夹是否存在 */
    exists(path: string): boolean {
        if (this._store.has(path)) return true;
        if (this._folders.has(path)) return true;
        const normalized = path.endsWith('/') ? path.slice(0, -1) : path + '/';
        if (this._folders.has(normalized)) return true;
        return false;
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
    modify = async (file: TFile, data: string): Promise<void> => {
        this._store.set(file.path, data);
    };

    /** 模拟文件删除 */
    async delete(file: TAbstractFile): Promise<void> {
        this._store.delete(file.path);
        this._folders.delete(file.path);
    }

    /** 模拟文件创建 */
    async create(path: string, data: string): Promise<TFile> {
        this._store.set(path, data);
        const f = new TFile();
        f.path = path;
        f.name = path.split('/').pop() || 'unknown.md';
        f.basename = f.name.replace(/\.[^/.]+$/, '');
        f.extension = f.name.includes('.') ? f.name.split('.').pop() || '' : '';
        f.vault = this;
        f.stat.size = data.length;
        return f;
    }

    /** 模拟文件夹创建 */
    async createFolder(path: string): Promise<TFolder> {
        this._folders.add(path);
        const f = new TFolder();
        f.path = path;
        f.name = path.split('/').pop() || path;
        f.vault = this;
        return f;
    }

    /** 模拟根据路径获取文件或文件夹 */
    getAbstractFileByPath(path: string): TAbstractFile | null {
        // 忠实模拟 Obsidian：**点文件（.project 等）不进入 vault 索引**，
        // getAbstractFileByPath 对它们恒为 null（见 shared/paths.ts v31 注释）。
        // 此前 mock 对任意 _store 命中都返回 TFile，导致
        // `readFanficRules` 用 getAbstractFileByPath 读 `.project` 的缺陷
        // 在生产里永远失效、在测试里却全绿——测试替身掩盖了真实行为差异。
        // 需要读点文件的代码必须走 adapter（mock 的 DataAdapter 支持）。
        const baseName = path.split('/').pop() || '';
        if (baseName.startsWith('.')) return null;
        if (this._store.has(path)) {
            const f = new TFile();
            f.path = path;
            f.name = path.split('/').pop() || 'unknown.md';
            f.basename = f.name.replace(/\.[^/.]+$/, '');
        f.extension = f.name.includes('.') ? f.name.split('.').pop() || '' : '';
            f.vault = this;
            f.stat.size = (this._store.get(path) || '').length;
            return f;
        }
        let folderPath = path;
        if (!this._folders.has(folderPath)) {
            const normalized = folderPath.endsWith('/') ? folderPath.slice(0, -1) : folderPath + '/';
            if (this._folders.has(normalized)) {
                folderPath = normalized;
            }
        }
        if (this._folders.has(folderPath)) {
            return this._makeFolder(folderPath);
        }
        return null;
    }

    /** 递归构造 TFolder.children（文件 + 子文件夹），供目录遍历逻辑使用 */
    private _makeFolder(folderPath: string): TFolder {
        const canonical = folderPath.replace(/\/+$/, '');
        const folder = new TFolder();
        folder.path = canonical;
        folder.name = canonical.split('/').filter(Boolean).pop() || canonical;
        folder.vault = this;
        const prefix = `${canonical}/`;
        const folderChildren: TFolder[] = [];
        const fileChildren: TFile[] = [];
        for (const filePath of this._store.keys()) {
            if (!filePath.startsWith(prefix)) continue;
            if (filePath.slice(prefix.length).includes('/')) continue;
            const child = new TFile();
            child.path = filePath;
            child.name = filePath.split('/').pop() || 'unknown.md';
            child.basename = child.name.replace(/\.[^/.]+$/, '');
        child.extension = child.name.includes('.') ? child.name.split('.').pop() || '' : '';
            child.vault = this;
            child.stat.size = (this._store.get(filePath) || '').length;
            fileChildren.push(child);
        }
        for (const childPath of this._folders) {
            const normalized = childPath.replace(/\/+$/, '');
            if (!normalized.startsWith(prefix)) continue;
            const rest = normalized.slice(prefix.length);
            if (!rest || rest.includes('/')) continue;
            folderChildren.push(this._makeFolder(normalized));
        }
        folder.children = [...fileChildren, ...folderChildren];
        return folder;
    }

    getFiles(): TFile[] {
        const files: TFile[] = [];
        for (const path of this._store.keys()) {
            const f = new TFile();
            f.path = path;
            f.name = path.split('/').pop() || 'unknown.md';
            f.basename = f.name.replace(/\.[^/.]+$/, '');
        f.extension = f.name.includes('.') ? f.name.split('.').pop() || '' : '';
            f.vault = this;
            f.stat.size = (this._store.get(path) || '').length;
            files.push(f);
        }
        return files;
    }

    /** 模拟 Vault.getAllLoadedFiles：已创建文件夹 + 全部文件 */
    getAllLoadedFiles(): TAbstractFile[] {
        const folders: TAbstractFile[] = [];
        for (const path of this._folders) {
            const f = new TFolder();
            f.path = path;
            f.name = path.split('/').filter(Boolean).pop() || path;
            f.vault = this;
            folders.push(f);
        }
        return [...folders, ...this.getFiles()];
    }
}

/** 模拟 DataAdapter（底层文件系统适配器，用于点文件访问） */
export class DataAdapter {
    private _store: Map<string, string>;
    private _folders: Set<string>;

    constructor(store: Map<string, string>, folders: Set<string>) {
        this._store = store;
        this._folders = folders;
    }

    async exists(path: string): Promise<boolean> {
        return this._store.has(path) || this._folders.has(path);
    }

    async read(path: string): Promise<string> {
        return this._store.get(path) ?? '';
    }

    async write(path: string, data: string): Promise<void> {
        this._store.set(path, data);
    }

    async mkdir(path: string): Promise<void> {
        this._folders.add(path);
    }

    async rmdir(path: string, _recursive?: boolean): Promise<void> {
        this._folders.delete(path);
    }

    async remove(path: string): Promise<void> {
        this._store.delete(path);
    }

    /** 模拟改名/移动：损坏文件留档等逻辑依赖 */
    async rename(oldPath: string, newPath: string): Promise<void> {
        const content = this._store.get(oldPath);
        if (content === undefined) return;
        this._store.delete(oldPath);
        this._store.set(newPath, content);
    }

    /** 模拟 stat：落盘校验依赖 size 判断文件是否真实写入 */
    async stat(path: string): Promise<{ type: string; ctime: number; mtime: number; size: number } | null> {
        const content = this._store.get(path);
        if (content === undefined) return null;
        return { type: 'file', ctime: 0, mtime: 0, size: content.length };
    }

    async list(path: string): Promise<{ files: string[]; folders: string[] }> {
        const prefix = path.endsWith('/') ? path : path + '/';
        const files: string[] = [];
        const folders: string[] = [];
        for (const p of this._store.keys()) {
            if (p.startsWith(prefix) && !p.substring(prefix.length).includes('/')) {
                files.push(p);
            }
        }
        for (const p of this._folders) {
            if (p.startsWith(prefix) && !p.substring(prefix.length).includes('/')) {
                folders.push(p);
            }
        }
        return { files, folders };
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

/** U11：step-result-viewer 等按平台分流 UI 的模块依赖 Platform 判定 */
export const Platform = {
    isMobile: false,
    isDesktop: true,
    isDesktopApp: true,
    isMobileApp: false,
};

/** Menu mock：记录 addItem 构建的条目，供模型快速切换器等组件的单测断言 */
export interface MockMenuItemState {
    title: string;
    icon?: string;
    checked?: boolean;
    onClick?: (evt?: MouseEvent) => void;
}

export class Menu {
    /** 最近一次实例，便于测试直接读取（多级菜单依次弹出时取最新） */
    static lastInstance: Menu | null = null;
    items: MockMenuItemState[] = [];
    shownAtMouseEvent: MouseEvent | null = null;
    shownAtPosition: { x: number; y: number } | null = null;

    constructor() {
        Menu.lastInstance = this;
    }

    addItem(build: (item: {
        setTitle(title: string): unknown;
        setIcon(icon: string): unknown;
        setChecked(checked: boolean): unknown;
        onClick(cb: (evt?: MouseEvent) => void): unknown;
    }) => void): this {
        const state: MockMenuItemState = { title: '' };
        const builder = {
            setTitle(title: string) { state.title = title; return builder; },
            setIcon(icon: string) { state.icon = icon; return builder; },
            setChecked(checked: boolean) { state.checked = checked; return builder; },
            onClick(cb: (evt?: MouseEvent) => void) { state.onClick = cb; return builder; },
        };
        build(builder as Parameters<typeof build>[0]);
        this.items.push(state);
        return this;
    }

    addSeparator(): this {
        return this;
    }

    showAtMouseEvent(evt: MouseEvent): this {
        this.shownAtMouseEvent = evt;
        return this;
    }

    showAtPosition(pos: { x: number; y: number }): this {
        this.shownAtPosition = pos;
        return this;
    }

    hide(): this {
        return this;
    }
}

export class Notice {
    message: string | DocumentFragment;
    timeout?: number;
    constructor(message: string | DocumentFragment, timeout?: number) {
        this.message = message;
        this.timeout = timeout;
    }
    /** 进度型 Notice 会复用同一条并更新文案 */
    setMessage(message: string | DocumentFragment): this {
        this.message = message;
        return this;
    }
    hide(): void {}
}

export class App {
    vault: Vault = new Vault();
    metadataCache: MetadataCache = new MetadataCache();
    fileManager: FileManager = new FileManager();
    workspace: Workspace = new Workspace();
}

export class Workspace {
    leftSplit = { expand: (): void => {} };
    rightSplit = { expand: (): void => {} };
    activeLeaf: WorkspaceLeaf | null = null;
    getLeaf(_mode?: string | boolean): any { return new WorkspaceLeaf(); }
    getLeftLeaf(_newLeaf?: boolean): WorkspaceLeaf { return new WorkspaceLeaf(); }
    getRightLeaf(_newLeaf?: boolean): WorkspaceLeaf { return new WorkspaceLeaf(); }
    getLeavesOfType(_type: string): any[] { return []; }
    setActiveLeaf(leaf: WorkspaceLeaf, _params?: { focus?: boolean }): void { this.activeLeaf = leaf; }
    revealLeaf(_leaf: any): void {}
    on(_event: string, _callback: (...args: any[]) => any): any { return { off: () => {} }; }
    trigger(_event: string, _data?: any): void {}
    /** PF-1：向量库预热挂在布局就绪后；测试里同步执行，保持「初始化会完成」的语义 */
    onLayoutReady(callback: () => void): void { callback(); }
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
    modalEl: HTMLElement = document.createElement('div');
    contentEl: HTMLElement = document.createElement('div');
    titleEl: HTMLElement = document.createElement('div');
    constructor() {
        // 真实 Modal 的层级是 modalEl ⊃ titleEl/contentEl；测试里挂上父子链，
        // 否则 onOpen 里 contentEl.parentElement 为 undefined。
        // 旧测试可能用平面对象替 document.createElement：无 appendChild 时跳过挂链
        if (typeof (this.modalEl as { appendChild?: unknown }).appendChild === 'function') {
            this.modalEl.appendChild(this.titleEl);
            this.modalEl.appendChild(this.contentEl);
        }
    }
    open(): void {}
    close(): void {}
    onOpen(): void {}
    onClose(): void {}
}

/**
 * PluginSettingTab 测试替身：复现真实 Obsidian 语义——containerEl 在构造时创建，
 * display() 由宿主（设置页外壳）在打开时调用。
 */
export class PluginSettingTab extends Component {
    app: App;
    containerEl: HTMLElement;
    constructor(app: App, plugin: unknown) {
        super();
        this.app = app;
        this.containerEl = document.createElement('div') as HTMLElement;
        void plugin;
    }
    display(): void {}
    hide(): void {}
}

export class WorkspaceLeaf {
    view: ItemView = new ItemView();
    getRoot(): unknown { return null; }
    setViewState(_state: unknown): Promise<void> { return Promise.resolve(); }
}

export class MarkdownRenderer {
    static async render(
        _app: App, _markdown: string, _el: HTMLElement,
        _sourcePath: string, _component: Component,
    ): Promise<void> {}
}

export function htmlToMarkdown(_html: string): string { return ''; }
/** 测试替身：只标记已清洗，具体 DOM 解析交给 jsdom/真实运行时 */
export function sanitizeHTMLToDom(html: string): DocumentFragment {
    return { html, sanitized: true } as unknown as DocumentFragment;
}
export function requestUrl(_req: any): Promise<any> { return Promise.resolve({ status: 200, json: {} }); }
export function request(_req: any): Promise<any> { return Promise.resolve({ status: 200, json: {} }); }
export function getIcon(_iconId: string): HTMLElement { return document.createElement('span'); }
export function setIcon(_el: HTMLElement, _iconId: string): void {}
export function normalizePath(_path: string): string { return _path; }

/** Obsidian 公开 API：把 frontmatter 字段读成字符串数组（数组或单值） */
export function parseFrontMatterStringArray(frontmatter: any, key: string): string[] | null {
    const value = frontmatter?.[key];
    if (value === undefined || value === null) return null;
    if (Array.isArray(value)) return value.map((item) => String(item));
    return [String(value)];
}

export function parseYaml(yaml: string): any {
    try {
        const result: Record<string, any> = {};
        const lines = yaml.split('\n').filter(l => !l.trim().startsWith('#') && l.trim() !== '');
        for (const line of lines) {
            const match = line.match(/^([^:]+):\s*(.*)$/);
            if (match) {
                const key = match[1].trim();
                let value: any = match[2].trim();
                if (value.startsWith('"') && value.endsWith('"')) {
                    value = value.slice(1, -1);
                } else if (value.startsWith("'") && value.endsWith("'")) {
                    value = value.slice(1, -1);
                } else if (value === 'true') value = true;
                else if (value === 'false') value = false;
                else if (!isNaN(Number(value)) && value !== '') value = Number(value);
                else if (value.startsWith('[') && value.endsWith(']')) {
                    try { value = JSON.parse(value); } catch { value = value; }
                }
                result[key] = value;
            }
        }
        return result;
    } catch {
        return {};
    }
}

export function stringifyYaml(obj: any): string {
    if (!obj || typeof obj !== 'object') return '';
    const lines: string[] = [];
    for (const [key, value] of Object.entries(obj)) {
        if (typeof value === 'string') {
            lines.push(`${key}: ${value}`);
        } else if (typeof value === 'number' || typeof value === 'boolean') {
            lines.push(`${key}: ${value}`);
        } else if (Array.isArray(value)) {
            lines.push(`${key}: ${JSON.stringify(value)}`);
        } else {
            lines.push(`${key}: ${JSON.stringify(value)}`);
        }
    }
    return lines.join('\n') + '\n';
}

/** 设置行（UI 测试用最小实现；链式 API 与 Obsidian 保持一致） */
export class Setting {
    settingEl: HTMLElement;
    nameEl: HTMLElement;
    descEl: HTMLElement;
    controlEl: HTMLElement;
    components: any[] = [];

    constructor(containerEl: HTMLElement) {
        this.settingEl = document.createElement('div');
        this.nameEl = document.createElement('div');
        this.descEl = document.createElement('div');
        this.controlEl = document.createElement('div');
        this.settingEl.append(this.nameEl, this.descEl, this.controlEl);
        containerEl?.append?.(this.settingEl);
    }

    setName(name: string): this { this.nameEl.textContent = name; return this; }
    setDesc(desc: string): this { this.descEl.textContent = desc; return this; }
    setClass(cls: string): this { this.settingEl.className = cls; return this; }
    setHeading(): this { return this; }
    setDisabled(disabled: boolean): this {
        this.settingEl.toggleAttribute('disabled', disabled);
        return this;
    }
    setTooltip(): this { return this; }
    clear(): this { this.components = []; return this; }
    then(cb: (value: this) => unknown): this { cb(this); return this; }

    private component(extra: Record<string, unknown> = {}): any {
        const inputEl = document.createElement('input');
        const component: any = {
            inputEl,
            selectEl: document.createElement('select'),
            buttonEl: document.createElement('button'),
            setPlaceholder() { return component; },
            setValue() { return component; },
            setLimits() { return component; },
            setDynamicTooltip() { return component; },
            setDisabled() { return component; },
            onChange() { return component; },
            addOption() { return component; },
            addOptions() { return component; },
            addButton() { return component; },
            setButtonText() { return component; },
            setTooltip() { return component; },
            setIcon() { return component; },
            setWarning() { return component; },
            setAttr() { return component; },
            setCta() { return component; },
            onClick() { return component; },
            ...extra,
        };
        this.components.push(component);
        this.controlEl.append(inputEl);
        return component;
    }

    addText(cb?: (component: any) => unknown): this { if (cb) cb(this.component()); return this; }
    addTextArea(cb?: (component: any) => unknown): this { if (cb) cb(this.component()); return this; }
    addToggle(cb?: (component: any) => unknown): this {
        const component = this.component({ setValue() { return component; } });
        if (cb) cb(component);
        return this;
    }
    addDropdown(cb?: (component: any) => unknown): this { return this.addText(cb); }
    addButton(cb?: (component: any) => unknown): this { return this.addText(cb); }
    addExtraButton(cb?: (component: any) => unknown): this { return this.addText(cb); }
    addSlider(cb?: (component: any) => unknown): this { return this.addText(cb); }
    addColorPicker(cb?: (component: any) => unknown): this { return this.addText(cb); }
    addSearch(cb?: (component: any) => unknown): this { return this.addText(cb); }
    addMomentFormat(cb?: (component: any) => unknown): this { return this.addText(cb); }
}
