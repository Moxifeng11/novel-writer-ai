/**
 * pet-image-settings.ts — 桌宠自定义形象设置（选择图片 / 网格 / 预览）
 *
 * 设计前提：插件不内置第三方美术资源（版权/商用限制），
 * 默认用代码绘制的分层 SVG；用户可指定自己的图片并按网格切帧。
 */

import { FuzzySuggestModal, Notice, Setting, TFile } from 'obsidian';
import type NovelWriterPlugin from '@/main';
import {
    describePetImageConfig,
    detectPetGrid,
    isSupportedImagePath,
    normalizePetImageConfig,
    PET_IMAGE_DEFAULT_COLS,
    PET_IMAGE_DEFAULT_ROWS,
    PET_IMAGE_MOOD_ORDER,
    type PetImageConfig,
} from '@/shared/pet-image-model';
import { clearPetImageFromDisk, savePetImageToDisk } from '@/shared/pet-image-store';

/**
 * 图片选择器：列出 vault 内的图片文件。
 */
class PetImagePickerModal extends FuzzySuggestModal<TFile> {
    private readonly onPick: (file: TFile) => void;

    constructor(app: NovelWriterPlugin['app'], onPick: (file: TFile) => void) {
        super(app);
        this.onPick = onPick;
        this.setPlaceholder('选择一张桌宠图片（PNG / JPG / WebP）');
    }

    /**
     * 候选文件。
     *
     * @returns 图片文件列表
     */
    getItems(): TFile[] {
        return this.app.vault.getFiles().filter(file => isSupportedImagePath(file.path));
    }

    /**
     * 候选项展示文本。
     *
     * @param file - 文件
     * @returns 路径
     */
    getItemText(file: TFile): string {
        return file.path;
    }

    /**
     * 选中回调。
     *
     * @param item - 选中的文件
     */
    onChooseItem(item: TFile): void {
        this.onPick(item);
    }
}

/**
 * 渲染桌宠形象设置。
 *
 * @param container - 容器
 * @param plugin - 插件实例
 * @param rerender - 重渲染回调
 */
export function renderPetImageSettings(
    container: HTMLElement,
    plugin: NovelWriterPlugin,
    rerender: () => void,
): void {
    const current = normalizePetImageConfig((plugin.settings as { petImage?: unknown }).petImage);

    container.createEl('h4', { text: '🎨 桌宠形象' });
    container.createEl('p', {
        text: '默认使用插件内置的代码绘制形象（无第三方素材）。可以选电脑上任意位置的图片（自动压缩后存在插件数据里，不进仓库），也可以选 vault 里的图片。'
            + '雪碧图约定：**每格 = 一个状态**，按从左到右、从上到下依次对应 '
            + `${PET_IMAGE_MOOD_ORDER.join(' / ')}（格子不够时后面的状态共用最后一格）。`
            + '桌宠会根据**正在运行的功能**（写作中 / AI 思考 / 刚完成 / 出错 / 待机）切到对应格子，不自动循环播放。'
            + '选图后会自动识别网格，识别不准可手动改或点「重新识别」。',
        cls: 'setting-item-description',
    });

    new Setting(container)
        .setName('图片路径')
        .setDesc(current ? `当前：${describePetImageConfig(current)}` : '未设置时使用内置绘制形象')
        .addText(text => {
            text.setPlaceholder('例如 素材/桌宠.png');
            text.setValue(current?.source === 'vault' ? (current.path ?? '') : '');
            text.inputEl.addEventListener('change', () => {
                const path = text.inputEl.value.trim();
                if (!path) {
                    void applyPetImage(plugin, null, rerender);
                    return;
                }
                if (!isSupportedImagePath(path)) {
                    new Notice('❌ 仅支持 PNG / JPG / WebP / GIF 图片');
                    return;
                }
                void applyVaultImage(plugin, path, current, rerender);
            });
        })
        .addButton(button => button
            .setButtonText('选择电脑图片')
            .setCta()
            .onClick(() => {
                pickLocalImage({}, async (dataUrl, image) => {
                    const grid = detectPetGrid(image.width, image.height);
                    const config = normalizePetImageConfig({
                        source: 'file',
                        dataUrl,
                        cols: grid.cols,
                        rows: grid.rows,
                    });
                    if (!config) {
                        new Notice('❌ 无法读取该图片，请换一张试试');
                        return;
                    }
                    new Notice(`✅ 已识别网格 ${grid.cols} 列 × ${grid.rows} 行，共 ${grid.cols * grid.rows} 格（每格一个状态）`, 5000);
                    await applyPetImage(plugin, config, rerender);
                });
            }))
        .addButton(button => button
            .setButtonText('选择仓库图片')
            .onClick(() => {
                new PetImagePickerModal(plugin.app, (file) => {
                    void applyVaultImage(plugin, file.path, current, rerender);
                }).open();
            }))
        .addButton(button => button
            .setButtonText('清除')
            .setWarning()
            .onClick(() => void applyPetImage(plugin, null, rerender)));

    new Setting(container)
        .setName('网格自动识别')
        .setDesc('按图片尺寸推断列/行；识别不准时可手动改下面的数字')
        .addButton(button => button
            .setButtonText('重新识别')
            .setDisabled(!current)
            .onClick(async () => {
                if (!current) return;
                const size = await readPetImageSize(plugin, current);
                if (!size) {
                    new Notice('❌ 无法读取图片尺寸，请重新选择图片');
                    return;
                }
                const grid = detectPetGrid(size.width, size.height);
                const next = normalizePetImageConfig({ ...current, cols: grid.cols, rows: grid.rows });
                if (!next) return;
                new Notice(`✅ 已识别网格 ${grid.cols} 列 × ${grid.rows} 行，共 ${grid.cols * grid.rows} 格`, 5000);
                await applyPetImage(plugin, next, rerender);
            }));

    new Setting(container)
        .setName('网格列数')
        .setDesc('横向格子数（1–8）：与行数相乘 = 总状态格数（6 档状态，多出的格子不会用到）')
        .addText(text => {
            text.setValue(String(current?.cols ?? PET_IMAGE_DEFAULT_COLS));
            text.inputEl.addEventListener('change', () => {
                if (!current) return;
                const cols = parseInt(text.inputEl.value.trim(), 10);
                const next = normalizePetImageConfig({ ...current, cols: Number.isFinite(cols) ? cols : current.cols });
                void applyPetImage(plugin, next, rerender);
            });
        });

    new Setting(container)
        .setName('网格行数')
        .setDesc('纵向格子数（1–8）：每格一个状态；格子不足 6 个时后面的状态共用最后一格')
        .addText(text => {
            text.setValue(String(current?.rows ?? PET_IMAGE_DEFAULT_ROWS));
            text.inputEl.addEventListener('change', () => {
                if (!current) return;
                const rows = parseInt(text.inputEl.value.trim(), 10);
                const next = normalizePetImageConfig({ ...current, rows: Number.isFinite(rows) ? rows : current.rows });
                void applyPetImage(plugin, next, rerender);
            });
        });

    if (current) {
        const preview = container.createDiv({ cls: 'nw-pet-image-preview' });
        const resource = current.source === 'file'
            ? (current.dataUrl ?? plugin.getPetImageRuntimeDataUrl() ?? '')
            : plugin.app.vault.adapter.getResourcePath(current.path ?? '');
        preview.style.backgroundImage = `url(${resource})`;
        preview.style.backgroundSize = `${current.cols * 100}% ${current.rows * 100}%`;
        preview.createSpan({ cls: 'nw-pet-image-preview-hint', text: '预览（第一格；桌宠上按运行状态切换格子）' });
    }
}

/**
 * 载入图片尺寸（用于自动识别网格）。
 *
 * @param plugin - 插件实例
 * @param config - 当前图片配置
 * @returns 尺寸；读取失败返回 null
 */
async function readPetImageSize(
    plugin: NovelWriterPlugin,
    config: PetImageConfig,
): Promise<{ width: number; height: number } | null> {
    const src = config.source === 'file'
        ? (config.dataUrl ?? plugin.getPetImageRuntimeDataUrl() ?? '')
        : plugin.app.vault.adapter.getResourcePath(config.path ?? '');
    if (!src) return null;
    try {
        return await loadImageSize(src);
    } catch {
        // silent-ok: 尺寸读取失败由调用方提示重新选图
        return null;
    }
}

/**
 * 加载图片并返回自然尺寸。
 *
 * @param src - 图片 URL / data URL
 * @returns 尺寸
 */
function loadImageSize(src: string): Promise<{ width: number; height: number }> {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve({ width: image.naturalWidth || image.width, height: image.naturalHeight || image.height });
        image.onerror = () => reject(new Error('图片加载失败'));
        image.src = src;
    });
}

/**
 * 应用 vault 内图片，并按尺寸自动识别网格。
 *
 * @param plugin - 插件实例
 * @param path - vault 相对路径
 * @param current - 当前配置（保留用户手动设置时作为回退）
 * @param rerender - 重渲染回调
 */
async function applyVaultImage(
    plugin: NovelWriterPlugin,
    path: string,
    current: PetImageConfig | null,
    rerender: () => void,
): Promise<void> {
    let grid = { cols: current?.cols ?? PET_IMAGE_DEFAULT_COLS, rows: current?.rows ?? PET_IMAGE_DEFAULT_ROWS };
    try {
        const src = plugin.app.vault.adapter.getResourcePath(path);
        const size = src ? await loadImageSize(src) : null;
        if (size) grid = detectPetGrid(size.width, size.height);
    } catch {
        // silent-ok: 尺寸读取失败时沿用当前/默认网格，不阻塞应用图片
    }
    const config = normalizePetImageConfig({ source: 'vault', path, cols: grid.cols, rows: grid.rows });
    if (!config) {
        new Notice('❌ 无法识别该图片，请换一张试试');
        return;
    }
    new Notice(`✅ 已识别网格 ${grid.cols} 列 × ${grid.rows} 行（列=动画帧，行=状态）`, 5000);
    await applyPetImage(plugin, config, rerender);
}

/**
 * 本地图片选择器依赖（便于单测注入；默认用真实 DOM / FileReader / Image）。
 */
export interface LocalImagePickerDeps {
    /** 文档对象（默认全局 document） */
    doc?: Document;
    /** 把文件读成 data URL（默认 FileReader） */
    readAsDataUrl?(file: File): Promise<string>;
    /** 加载图片（默认 new Image + onload） */
    loadImage?(src: string): Promise<HTMLImageElement>;
    /** 错误提示（默认 Notice） */
    onError?(message: string): void;
}

/**
 * 打开系统文件选择器并读取图片（压缩到最长边 512px 后转 data URL）。
 *
 * 关键点（对抗审查修复）：
 *  - 文件 input 必须挂到 DOM 上再触发，否则 iOS/macOS 等平台 WebView 会静默忽略 click
 *    （用户表现就是「点了没反应」）；
 *  - 优先用 Chromium 的 showPicker()（用户激活更可靠），失败或不支持再退回 click()；
 *  - 取消（cancel 事件）与异常路径都会清理临时 input，避免 DOM 残留；
 *  - 读取 / 压缩 / 保存任一环节失败都会弹 Notice，不再静默失败。
 *
 * @param deps - 依赖（`doc` 必须是当前设置所在窗口的 document，Obsidian 1.15 起设置是独立窗口）
 * @param onPicked - 读取完成回调（data URL + 已加载图片；可返回 Promise，失败会被捕获并提示）
 * @example
 * ```ts
 * pickLocalImage({ doc: container.ownerDocument }, async dataUrl => {
 *     const config = normalizePetImageConfig({ source: 'file', dataUrl, cols: 2, rows: 2 });
 *     if (config) await applyPetImage(plugin, config, rerender);
 * });
 * ```
 */
export function pickLocalImage(
    deps: LocalImagePickerDeps,
    onPicked: (dataUrl: string, image: HTMLImageElement) => void | Promise<void>,
): void {
    // 文档必须是「用户当前点击所在窗口」：Obsidian 1.15 起设置是独立窗口，
    // 若在主窗口 document 上创建 input 并 showPicker，会因窗口未聚焦被浏览器拦截
    // （用户表现：点「选择电脑图片」完全没反应）。
    const active = typeof activeDocument !== 'undefined' && activeDocument ? activeDocument : null;
    const doc = deps.doc ?? active ?? (typeof document !== 'undefined' ? document : null);
    const notify = deps.onError ?? ((message: string) => new Notice(message));
    if (!doc) {
        notify('❌ 当前环境无法打开文件选择器');
        return;
    }
    const input = doc.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg,image/webp,image/gif';
    // 用 CSS 类隐藏（仓库禁止内联 style）；类名见 styles-src/16-writing-stats-pet.css
    input.className = 'nw-file-input-probe';

    let cleaned = false;
    const cleanup = (): void => {
        if (cleaned) return;
        cleaned = true;
        try {
            input.parentNode?.removeChild(input);
        } catch { // silent-ok: 节点已不在 DOM 时忽略
        }
    };

    input.addEventListener('change', () => {
        const file = input.files?.[0];
        if (!file) {
            cleanup();
            return;
        }
        void (async () => {
            try {
                const raw = deps.readAsDataUrl
                    ? await deps.readAsDataUrl(file)
                    : await readFileAsDataUrl(file);
                if (!raw) throw new Error('读取图片失败');
                const image = deps.loadImage ? await deps.loadImage(raw) : await loadImageElement(raw, doc);
                const dataUrl = downscaleToDataUrl(image, doc);
                await onPicked(dataUrl, image);
            } catch (error) {
                notify('❌ 读取或保存图片失败：' + (error instanceof Error ? error.message : String(error)));
            } finally {
                cleanup();
            }
        })();
    });
    input.addEventListener('cancel', cleanup);
    // 兜底清理：部分宿主（旧 WebView / 对话框被系统拦截）取消后不触发 cancel，
    // 但文件框关闭会让设置窗口重新获得焦点；聚焦后延迟清理，避免临时 input 堆积。
    const view = doc.defaultView;
    if (view) {
        const onWindowFocus = (): void => {
            try {
                view.setTimeout?.(cleanup, 800);
            } catch {
                // silent-ok: 定时器不可用时交给 cancel/change 清理
                cleanup();
            }
        };
        view.addEventListener('focus', onWindowFocus, { once: true });
    }

    const parent = doc.body ?? doc.documentElement;
    if (!parent) {
        notify('❌ 当前环境无法打开文件选择器');
        return;
    }
    parent.appendChild(input);

    try {
        const picker = input as HTMLInputElement & { showPicker?(): void };
        if (typeof picker.showPicker === 'function') {
            picker.showPicker();
        } else {
            input.click();
        }
    } catch {
        // showPicker 被拒绝（无用户激活 / 旧版本）→ 退回 click
        try {
            input.click();
        } catch (error) {
            cleanup();
            notify('❌ 无法打开文件选择器：' + (error instanceof Error ? error.message : String(error)));
        }
    }
}

/**
 * 用 FileReader 把文件读成 data URL。
 *
 * @param file - 用户选择的文件
 * @returns data URL
 */
function readFileAsDataUrl(file: File): Promise<string> {
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result ?? ''));
        reader.onerror = () => reject(new Error('读取文件失败'));
        reader.readAsDataURL(file);
    });
}

/**
 * 用 Image 加载 data URL。
 *
 * @param src - data URL
 * @returns 已加载的图片
 */
function loadImageElement(src: string, doc?: Document): Promise<HTMLImageElement> {
    return new Promise<HTMLImageElement>((resolve, reject) => {
        const ImageCtor = (doc?.defaultView as unknown as { Image?: new () => HTMLImageElement } | null)?.Image;
        const image = ImageCtor ? new ImageCtor() : new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error('无法解析该图片'));
        image.src = src;
    });
}

/**
 * 把图片等比缩到最长边 512px 并转 PNG data URL（控制插件数据体积）。
 *
 * @param image - 已加载的图片
 * @returns data URL
 */
function downscaleToDataUrl(image: HTMLImageElement, doc?: Document): string {
    const maxEdge = 512;
    const scale = Math.min(1, maxEdge / Math.max(image.width, image.height));
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));
    const targetDoc = doc ?? document;
    const canvas = targetDoc.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('无法创建画布');
    context.drawImage(image, 0, 0, width, height);
    return canvas.toDataURL('image/png');
}

/**
 * 保存并应用桌宠形象配置。
 *
 * @param plugin - 插件实例
 * @param config - 配置（null 表示恢复内置形象）
 * @param rerender - 重渲染回调
 */
async function applyPetImage(
    plugin: NovelWriterPlugin,
    config: PetImageConfig | null,
    rerender: () => void,
): Promise<void> {
    // 统一走插件入口：本机图片落插件目录（settings 只存元数据），
    // 避免 data.json 膨胀与「重载后字段丢失」。
    try {
        await plugin.applyPetImageConfig(config);
    } catch (error) {
        new Notice('❌ 保存桌宠形象失败：' + (error instanceof Error ? error.message : String(error)), 8000);
        return;
    }
    rerender();
}
