/**
 * degradation-notifier.ts — 统一降级事件系统
 *
 * 替代当前散落的 console.warn + onProgress 回调 + Notice + 日志文件"三不统一"局面。
 * 所有降级点统一发射 DegradationEvent，由 DegradationNotifier 单例聚合分发到多个通道：
 * - logger（结构化控制台日志，始终开启）
 * - 事件收集数组（供 UI / 摘要面板读取）
 * - 可选 sink（状态栏、Notice、Markdown 日志文件等，由宿主注入）
 *
 * 设计原则：
 * - 零依赖：仅依赖 logger，不 import obsidian，可在 Worker / 主线程 / 测试中复用
 * - 单例：模块级单例，任意模块可 import getDegradationNotifier()
 * - 可注入：sink 通过 registerSink 注入，便于状态栏/Notice 与测试解耦
 * - 幂等安全：sink 抛错不影响其他 sink 与主流程
 */

import { createLogger, type Logger } from './logger';

/** 降级来源：向量增强 / LLM 增强 / 质量档位 / 分析器注入 / Worker 运行时 */
export type DegradationSource = 'vector' | 'llm' | 'quality' | 'injection' | 'worker';

/** 降级严重程度 */
export type DegradationSeverity = 'info' | 'warning' | 'critical';

/** 统一降级事件 */
export interface DegradationEvent {
    /** 降级来源分类 */
    source: DegradationSource;
    /** 关联维度（如 style/rhythm/character；非维度相关可省略） */
    dimension?: string;
    /** 降级前的能力档位（如 "vector" / "llm" / "full"） */
    from: string;
    /** 降级后的能力档位（如 "statistics" / "keyword_stats"） */
    to: string;
    /** 降级原因（错误信息或说明） */
    reason: string;
    /** 严重程度 */
    severity: DegradationSeverity;
    /** 是否可恢复（如重试后可能成功） */
    recoverable: boolean;
    /** 发生时间戳 */
    timestamp: number;
}

/** 构造降级事件的入参（timestamp 与 severity 有默认值） */
export interface DegradationEventInput {
    source: DegradationSource;
    dimension?: string;
    from: string;
    to: string;
    reason: string;
    severity?: DegradationSeverity;
    recoverable?: boolean;
}

/** 降级事件消费者 */
export type DegradationSink = (event: DegradationEvent) => void;

/**
 * 降级通知器 — 聚合分发降级事件到多个通道。
 */
export class DegradationNotifier {
    private readonly log: Logger;
    private readonly sinks = new Set<DegradationSink>();
    private readonly events: DegradationEvent[] = [];
    private readonly maxEvents: number;

    constructor(options: { maxEvents?: number } = {}) {
        this.log = createLogger('Degradation');
        this.maxEvents = options.maxEvents ?? 200;
    }

    /**
     * 注册一个降级事件消费者（如状态栏更新、Notice 弹窗、Markdown 日志写入）。
     * @returns 取消注册的函数
     */
    registerSink(sink: DegradationSink): () => void {
        this.sinks.add(sink);
        return () => {
            this.sinks.delete(sink);
        };
    }

    /**
     * 发射一个降级事件。
     * 会写入结构化日志、追加到事件数组、分发给所有 sink。
     */
    notify(input: DegradationEventInput): DegradationEvent {
        const event: DegradationEvent = {
            source: input.source,
            dimension: input.dimension,
            from: input.from,
            to: input.to,
            reason: input.reason,
            severity: input.severity ?? 'warning',
            recoverable: input.recoverable ?? false,
            timestamp: Date.now(),
        };

        this.recordEvent(event);
        this.logEvent(event);
        this.dispatchToSinks(event);

        return event;
    }

    /** 获取已收集的降级事件（副本，按时间顺序） */
    getEvents(): DegradationEvent[] {
        return [...this.events];
    }

    /** 获取指定维度的降级事件 */
    getEventsByDimension(dimension: string): DegradationEvent[] {
        return this.events.filter((e) => e.dimension === dimension);
    }

    /** 是否存在指定维度的降级 */
    hasDegradation(dimension: string): boolean {
        return this.events.some((e) => e.dimension === dimension);
    }

    /** 清空已收集的事件（如开始新一轮拆解前） */
    clear(): void {
        this.events.length = 0;
    }

    private recordEvent(event: DegradationEvent): void {
        this.events.push(event);
        if (this.events.length > this.maxEvents) {
            this.events.splice(0, this.events.length - this.maxEvents);
        }
    }

    private logEvent(event: DegradationEvent): void {
        const scope = event.dimension ? `${event.source}:${event.dimension}` : event.source;
        const msg = `[${scope}] 降级 ${event.from} → ${event.to}: ${event.reason}`;
        if (event.severity === 'critical') {
            this.log.error(msg);
        } else if (event.severity === 'warning') {
            this.log.warn(msg);
        } else {
            this.log.info(msg);
        }
    }

    private dispatchToSinks(event: DegradationEvent): void {
        for (const sink of this.sinks) {
            try {
                sink(event);
            } catch (e) {
                this.log.error('降级事件 sink 执行失败:', e);
            }
        }
    }
}

/** 模块级单例 */
let notifierInstance: DegradationNotifier | null = null;

/** 获取全局降级通知器单例 */
export function getDegradationNotifier(): DegradationNotifier {
    if (!notifierInstance) {
        notifierInstance = new DegradationNotifier();
    }
    return notifierInstance;
}
