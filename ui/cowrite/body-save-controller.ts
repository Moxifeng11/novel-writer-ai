import { App, Notice } from 'obsidian';
import { BodyWriter } from '../../engine/body-writer';
import { createLogger } from '../../shared/logger';

const log = createLogger('BodySaveController');

/** D2：一次保存的章节身份快照，await 期间切章不影响写盘 */
export interface ChapterSaveIdentity {
    project: string;
    volume: string;
    chapterNum: number;
    chapterName: string;
    bodyPath: string;
}

/**
 * D2：协同写作保存管线的视图适配层。
 * 视图只负责提供「当前正文 / 当前身份 / UI 刷新」，保存串行、身份快照与
 * 切章冲刷都收敛在这里，避免继续膨胀 co-writing-view.ts。
 */
export interface BodySaveHost {
    readonly app: App;
    /** 右栏编辑器当前内容 */
    getBodyText(): string;
    /** 入口处快照当前章节身份 */
    getIdentity(): ChapterSaveIdentity;
    updateControlState(state: string): void;
    /** 按快照身份取章节标题（信息规划 / 大纲摘要） */
    getChapterTitle(identity: ChapterSaveIdentity): Promise<string>;
    /** 视图是否仍绑定快照里的章节 */
    isSameChapterIdentity(identity: ChapterSaveIdentity): boolean;
    /** 写盘成功后的 UI 刷新（指标 / 实时分析 / 结算提醒） */
    onSaved(): void;
    /** 取消防抖中的自动保存，返回是否存在待保存 */
    takePendingAutoSave(): boolean;
}

export class BodySaveController {
    private saving = false;

    constructor(private readonly host: BodySaveHost) {}

    get isSaving(): boolean {
        return this.saving;
    }

    async save(showNotice: boolean): Promise<boolean> {
        if (this.saving) return false;
        const body = this.host.getBodyText()?.trim();
        // 入口即快照身份：await 期间可能切章，后续一律用快照写盘与校验，
        // 不能再读视图当前身份（否则旧章正文会用新章路径落盘）。
        const identity = this.host.getIdentity();
        if (!body || !identity.project || !identity.volume || !identity.chapterNum) {
            // UX：未绑定章节或正文为空时静默返回会让用户误以为按钮失效
            if (showNotice) {
                new Notice(
                    !body ? "⚠️ 正文为空，无需保存" : "⚠️ 未绑定章节，请先在左侧选择卷/章",
                    3e3
                );
            }
            return false;
        }
        this.saving = true;
        this.host.updateControlState("保存中...");
        try {
            const chapterTitle = await this.host.getChapterTitle(identity);
            // 统一落盘入口：保留旧 frontmatter、统一标题与缩进、status 不降级
            const writer = new BodyWriter({ app: this.host.app });
            await writer.write({
                path: identity.bodyPath,
                raw: body,
                chapterNum: identity.chapterNum,
                chapterName: identity.chapterName || `第${identity.chapterNum}章`,
                title: chapterTitle,
                volume: identity.volume,
                project: identity.project,
                writingMode: "co-writer",
            });
            // 写盘期间已切章：不要把「已保存」与结算提醒写到新章界面
            if (!this.host.isSameChapterIdentity(identity)) return true;
            this.host.updateControlState("已保存");
            this.host.onSaved();
            if (showNotice)
                new Notice("✅ 正文已保存", 3e3);
            return true;
        } catch (e) {
            log.warn("[CoWritingView] 保存失败:", e);
            if (showNotice)
                new Notice("⚠️ 保存失败，请检查章节路径或文件权限", 4e3);
            return false;
        } finally {
            this.saving = false;
        }
    }

    /**
     * 切章前冲刷上一章排队中的自动保存。
     * 一旦视图先改 project/chapterNum，防抖里排队的保存就会用新章路径
     * 写入旧章正文；必须在改身份之前用旧身份落盘。
     * 返回 false 表示上一章未能保存，调用方应中止切章（避免丢字）。
     */
    async flushBeforeChapterSwitch(): Promise<boolean> {
        const hasPending = this.host.takePendingAutoSave();
        if (!hasPending) return true;
        const identity = this.host.getIdentity();
        if (!identity.project || !identity.volume || !identity.chapterNum) return true;
        return this.save(false);
    }
}
