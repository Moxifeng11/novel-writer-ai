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
    isSupportedImagePath,
    normalizePetImageConfig,
    PET_IMAGE_DEFAULT_COLS,
    PET_IMAGE_DEFAULT_ROWS,
    PET_IMAGE_MOOD_ORDER,
    type PetImageConfig,
} from '@/shared/pet-image-model';

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
        text: '默认使用插件内置的代码绘制形象（无第三方素材）。可以选**电脑上任意位置**的图片（自动压缩后存在插件数据里，不进仓库），也可以选 vault 里的图片；按 2×2 或 3×2 网格切帧，'
            + `状态顺序固定为 ${PET_IMAGE_MOOD_ORDER.join(' / ')}。`,
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
                const config = normalizePetImageConfig({
                    path,
                    cols: current?.cols ?? PET_IMAGE_DEFAULT_COLS,
                    rows: current?.rows ?? PET_IMAGE_DEFAULT_ROWS,
                });
                void applyPetImage(plugin, config, rerender);
            });
        })
        .addButton(button => button
            .setButtonText('选择电脑图片')
            .setCta()
            .onClick(() => {
                pickLocalImage(async (dataUrl) => {
                    const config = normalizePetImageConfig({
                        source: 'file',
                        dataUrl,
                        cols: current?.cols ?? PET_IMAGE_DEFAULT_COLS,
                        rows: current?.rows ?? PET_IMAGE_DEFAULT_ROWS,
                    });
                    if (!config) {
                        new Notice('❌ 无法读取该图片，请换一张试试');
                        return;
                    }
                    await applyPetImage(plugin, config, rerender);
                });
            }))
        .addButton(button => button
            .setButtonText('选择仓库图片')
            .onClick(() => {
                new PetImagePickerModal(plugin.app, (file) => {
                    const config = normalizePetImageConfig({
                        source: 'vault',
                        path: file.path,
                        cols: current?.cols ?? PET_IMAGE_DEFAULT_COLS,
                        rows: current?.rows ?? PET_IMAGE_DEFAULT_ROWS,
                    });
                    void applyPetImage(plugin, config, rerender);
                }).open();
            }))
        .addButton(button => button
            .setButtonText('清除')
            .setWarning()
            .onClick(() => void applyPetImage(plugin, null, rerender)));

    new Setting(container)
        .setName('网格列数')
        .setDesc('雪碧图横向帧数（1–8）；帧数不足 6 时部分状态会共用同一格')
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
        .setDesc('雪碧图纵向帧数（1–8）')
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
            ? (current.dataUrl ?? '')
            : plugin.app.vault.adapter.getResourcePath(current.path ?? '');
        preview.style.backgroundImage = `url(${resource})`;
        preview.style.backgroundSize = `${current.cols * 100}% ${current.rows * 100}%`;
        preview.createSpan({ cls: 'nw-pet-image-preview-hint', text: '预览（第一帧）' });
    }
}

/**
 * 打开系统文件选择器并读取图片（压缩到最长边 512px 后转 data URL）。
 *
 * 说明：用 <input type="file"> 而不是 fs，跨平台且不需要 Node 权限；
 * 图片只存在用户自己的插件数据里，不进仓库。
 *
 * @param onPicked - 读取完成回调（data URL）
 */
function pickLocalImage(onPicked: (dataUrl: string) => void): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg,image/webp,image/gif';
    input.addEventListener('change', () => {
        const file = input.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            const raw = String(reader.result ?? '');
            if (!raw) {
                new Notice('❌ 读取图片失败');
                return;
            }
            const image = new Image();
            image.onload = () => {
                try {
                    onPicked(downscaleToDataUrl(image));
                } catch (error) {
                    new Notice('❌ 图片处理失败：' + (error instanceof Error ? error.message : String(error)));
                }
            };
            image.onerror = () => new Notice('❌ 无法解析该图片');
            image.src = raw;
        };
        reader.onerror = () => new Notice('❌ 读取图片失败');
        reader.readAsDataURL(file);
    });
    input.click();
}

/**
 * 把图片等比缩到最长边 512px 并转 PNG data URL（控制插件数据体积）。
 *
 * @param image - 已加载的图片
 * @returns data URL
 */
function downscaleToDataUrl(image: HTMLImageElement): string {
    const maxEdge = 512;
    const scale = Math.min(1, maxEdge / Math.max(image.width, image.height));
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));
    const canvas = document.createElement('canvas');
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
    (plugin.settings as { petImage?: PetImageConfig }).petImage = config ?? undefined;
    await plugin.saveSettings();
    plugin.refreshWritingPet();
    rerender();
}
