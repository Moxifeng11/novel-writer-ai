import { App, Notice } from 'obsidian';
import { BodyWriter } from '@/engine/body-writer';
import { createLogger } from '@/shared/logger';

const log = createLogger('BodySaveController');

/** 单次保存/冲刷上限：文件被同步盘锁定时不能让切章/关视图永久等待 */
const SAVE_TIMEOUT_MS = 30_000;
const FLUSH_TIMEOUT_MS = 35_000;

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
    /**
     * 右栏编辑器当前内容
     *
     * @returns 文本结果
     */
    getBodyText(): string;
    /**
     * 入口处快照当前章节身份
     *
      * @returns ChapterSaveIdentity 实例
     */
    getIdentity(): ChapterSaveIdentity;
    updateControlState(state: string): void;
    /**
     * 按快照身份取章节标题（信息规划 / 大纲摘要）
     *
     * @param identity - 身份信息
     * @returns 文本结果
     */
    getChapterTitle(identity: ChapterSaveIdentity): Promise<string>;
    /**
     * 视图是否仍绑定快照里的章节
     *
     * @param identity - 身份信息
     * @returns 是否成功
     */
    isSameChapterIdentity(identity: ChapterSaveIdentity): boolean;
    /** 写盘成功后的 UI 刷新（指标 / 实时分析 / 结算提醒） */
    onSaved(): void;
    /**
     * 取消防抖中的自动保存，返回是否存在待保存
     *
     * @returns 是否成功
     */
    takePendingAutoSave(): boolean;
    /** 排一次自动保存（视图负责 2s 防抖） */
    scheduleAutoSave(): void;
    /** 项目已被删除：视图清空章节绑定，避免自动保存反复写回并重建目录 */
    onProjectMissing?(): void;
}

/**
 * BodySaveController 类。
 */
export class BodySaveController {
    private saving = false;
    /**
     * 每个正文路径「本视图最后一次成功写入的正文」。用于识别外部写入：
     * P0-6（v4.27）——协同视图按整篇编辑器内容自动保存，若工作台一键成文/续写
     * 已把新正文写进同一文件，协同的 2s 自动保存会把新稿整章覆盖（数据丢失）。
     * 规则：磁盘正文既不是本视图上次写的、也不是当前要写的 → 判定外部修改，拒绝覆盖。
     */
    private lastWritten = new Map<string, string>();
    /** 已提示过冲突的路径，避免自动保存反复弹窗 */
    private conflictNotified = new Set<string>();
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

    private async withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
        let timer: ReturnType<typeof setTimeout> | null = null;
        try {
            return await Promise.race([
                promise,
                new Promise<T>((_, reject) => {
                    timer = setTimeout(() => reject(new Error(`${label}超时（${Math.round(ms / 1000)}s），请检查文件是否被同步盘占用`)), ms);
                }),
            ]);
        } finally {
            if (timer !== null) clearTimeout(timer);
        }
    }

    /**
     * 保存。
     * @param showNotice - 提示函数
     * @returns 是否成功
     */
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
            const chapterTitle = await this.withTimeout(this.host.getChapterTitle(identity), 10_000, '读取章节标题');
            // 外部写入检测（P0-6）：只在本视图写过的路径上生效，首次保存不拦截
            const conflict = await this.withTimeout(
                this.detectExternalOverwrite(identity.bodyPath, body),
                15_000,
                '检查外部修改',
            );
            if (conflict) {
                this.host.updateControlState("外部已修改");
                if (!this.conflictNotified.has(identity.bodyPath)) {
                    this.conflictNotified.add(identity.bodyPath);
                    new Notice(
                        "⚠️ 该章正文刚被其他入口（一键成文/续写）改写，已跳过本次自动保存以免覆盖新稿；"
                        + "请重新打开本章后再编辑。",
                        8000,
                    );
                }
                return false;
            }
            // 统一落盘入口：保留旧 frontmatter、统一标题与缩进、status 不降级
            const writer = new BodyWriter({ app: this.host.app });
            await this.withTimeout(writer.write({
                path: identity.bodyPath,
                raw: body,
                chapterNum: identity.chapterNum,
                chapterName: identity.chapterName || `第${identity.chapterNum}章`,
                title: chapterTitle,
                volume: identity.volume,
                project: identity.project,
                writingMode: "co-writer",
            }), SAVE_TIMEOUT_MS, '保存正文');
            this.lastWritten.set(identity.bodyPath, body);
            this.conflictNotified.delete(identity.bodyPath);
            // 写盘期间已切章：不要把「已保存」与结算提醒写到新章界面
            if (!this.host.isSameChapterIdentity(identity)) return true;
            this.host.updateControlState("已保存");
            this.host.onSaved();
            if (showNotice)
                new Notice("✅ 正文已保存", 3e3);
            return true;
        } catch (e) {
            log.warn("[CoWritingView] 保存失败:", e);
            const message = e instanceof Error ? e.message : String(e);
            // 项目已被删除：继续自动保存会在旧路径重建 03-大纲与章节 与 _versions，
            // 把已删除项目“复活”。清空绑定并停止后续写入。
            if (message.includes('已不存在') || message.includes('缺少项目标志')) {
                this.host.onProjectMissing?.();
                if (showNotice) new Notice("⚠️ 项目已删除，已停止保存并清空章节绑定", 6e3);
                return false;
            }
            // 状态栏不能停在「保存中...」，否则用户会以为仍在保存/已保存
            if (this.host.isSameChapterIdentity(identity)) {
                this.host.updateControlState("保存失败");
            }
            if (showNotice)
                new Notice(`⚠️ 保存失败：${message || '请检查章节路径或文件权限'}`, 6e3);
            return false;
        } finally {
            this.saving = false;
        }
    }

    /**
     * 磁盘正文是否被本视图之外的入口改过。
     * - 该路径没有本视图的写入记录（首次保存）→ 不拦截（用户可能刚编辑过）
     * - 磁盘正文 == 本视图上次写入 → 无外部修改
     * - 磁盘正文 == 本次要写的正文 → 无实质变化
     * - 否则 → 判定外部覆盖
     */
    private async detectExternalOverwrite(bodyPath: string, nextBody: string): Promise<boolean> {
        const baseline = this.lastWritten.get(bodyPath);
        if (baseline === undefined) return false;
        try {
            const adapter = this.host.app.vault.adapter;
            if (!(await adapter.exists(bodyPath))) return false;
            const raw = await adapter.read(bodyPath);
            const diskBody = stripBodyForCompare(raw);
            if (diskBody === stripBodyForCompare(baseline)) return false;
            if (diskBody === stripBodyForCompare(nextBody)) return false;
            return true;
        } catch (e) {
            log.warn('[BodySaveController] 外部写入检测失败，按无冲突处理:', e);
            return false;
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
     * @returns 是否成功
     */
    async flushBeforeChapterSwitch(): Promise<boolean> {
        const hasPending = this.host.takePendingAutoSave();
        try {
            await this.withTimeout(this.chain, FLUSH_TIMEOUT_MS, '等待上一次保存');
        } catch (e) {
            log.warn('[BodySaveController] 切章前等待保存超时:', e);
            new Notice('⚠️ 上一次保存超时，已中止切章以避免丢字；请稍后重试', 6e3);
            return false;
        }
        const identity = this.host.getIdentity();
        if (!identity.project || !identity.volume || !identity.chapterNum) return true;
        if (!hasPending) return true;
        return this.save(false);
    }
}

/** 比较用：剥离 frontmatter 与大小写无关的空白差异（只用于冲突判定） */
/**
 * 比较用：剥离 frontmatter、标题行与空白差异（只用于冲突判定）。
 * 标题行必须剥：编辑器内容是「正文」，磁盘文件是「# 第N章 标题 + 正文」，
 * 不剥离会把每次正常保存都判成外部修改。
 * @param raw - 原始
 * @returns 文本结果
 */
function stripBodyForCompare(raw: string): string {
    return String(raw || '')
        .replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '')
        .replace(/^\s*#\s*第[^\n]*\n+/, '')
        .replace(/\s+/g, '')
        .trim();
}
