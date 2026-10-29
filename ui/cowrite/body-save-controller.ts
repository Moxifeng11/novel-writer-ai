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
    /** 排一次自动保存（视图负责 2s 防抖） */
    scheduleAutoSave(): void;
}

export class BodySaveController {
    private saving = false;
    /**
     * 串行链：所有保存按调用顺序排队。
     * 旧实现用 `if (this.saving) return false` 直接丢弃并发请求，
     * 调用方（切章冲刷 / Ctrl+S / 关闭视图）会把「被丢弃」当成「写盘失败」，
     * 而冲刷路径在调用前已经取消了防抖定时器 → 这段输入永久不落盘。
     */
    private chain: Promise<unknown> = Promise.resolve();

    constructor(private readonly host: BodySaveHost) {}

    get isSaving(): boolean {
        return this.saving;
    }

    /**
     * 程序化改写正文后调用（采纳建议 / 知识标签 / 历史回填 / AI 修复）。
     * 这些写入不派发 input 事件，旧实现的自动保存只挂在 input 上，
     * 于是「采纳后立刻切章」会把刚插入的文字丢掉。
     */
    markDirty(): void {
        this.host.scheduleAutoSave();
    }

    async save(showNotice: boolean): Promise<boolean> {
        // 入口即快照：排队执行与 await 期间可能切章、也可能继续输入。
        // 正文与身份都必须在这一刻定下来，否则排队的保存会把新章正文写到旧章路径。
        const snapshot = {
            body: this.host.getBodyText()?.trim(),
            identity: this.host.getIdentity(),
        };
        const run = this.chain.then(() => this.performSave(snapshot, showNotice));
        // 链上吞掉错误，单次失败不能卡死后续保存
        this.chain = run.catch(() => undefined);
        return run;
    }

    private async performSave(
        snapshot: { body?: string; identity: ChapterSaveIdentity },
        showNotice: boolean,
    ): Promise<boolean> {
        const { body, identity } = snapshot;
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
     *
     * 先等在途保存结束再判断：旧实现先取消防抖定时器、再遇到 `saving` 直接返回 false，
     * 用户重试一次切章（此时已无 pending）就会真的把这段文字丢掉。
     */
    async flushBeforeChapterSwitch(): Promise<boolean> {
        const hasPending = this.host.takePendingAutoSave();
        const inFlight = this.chain;
        await inFlight;
        const identity = this.host.getIdentity();
        if (!identity.project || !identity.volume || !identity.chapterNum) return true;
        if (!hasPending) return true;
        return this.save(false);
    }
}
