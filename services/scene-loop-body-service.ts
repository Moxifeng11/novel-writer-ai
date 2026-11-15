/**
 * scene-loop-body-service.ts — 正文步场景循环生成（A1）
 *
 * 背景：`SceneGenerationLoop`（逐场生成、失败隔离、断点复用）早已实现，但正文步一直
 * 走"整章一次性生成"。本服务把循环封装成可测试的编排层：
 *
 *   Scene 展开 → 逐场生成（场景任务卡 + 上一场结尾 + 约束块）→ 合并 → 落盘
 *
 * 职责边界：本服务只做编排与合并落盘；场景正文生成回调与正文写入由调用方注入，
 * 因此可在不触碰 AI/UI 的前提下测试。
 */

import { App, TFile, TFolder } from 'obsidian';
import { createLogger } from '@/shared/logger';
import type { SceneLoopResult } from '@/engine/scene-generation-loop';

const log = createLogger('SceneLoopBody');

/** 场景合并分隔符（与正文自然段分隔一致） */
const SCENE_SEPARATOR = '\n\n';

/** 依赖注入 */
export interface SceneLoopBodyDeps {
    /** 跑一次场景循环（插件侧注入 SceneGenerationLoop.run） */
    runLoop(expansionText: string): Promise<SceneLoopResult>;
    /** 读取文本（不存在返回空串） */
    readText(path: string): Promise<string>;
    /** 写入正文（走 BodyWriter） */
    writeBody(project: string, chapterName: string, body: string): Promise<void>;
    /** 按后缀找文件 */
    findBySuffix(project: string, suffix: string): Promise<string | null>;
}

/** 生成结果 */
export interface SceneLoopBodyResult {
    /** 是否只预览 */
    dryRun: boolean;
    /** 成功场景数 */
    scenes: number;
    /** 失败场景序号 */
    failedScenes: number[];
    /** 合并后的正文（未落盘时也返回，供流水线复用） */
    body: string;
    /** 合并后的正文字符数 */
    chars: number;
    /** 是否全部场景生成成功 */
    completedAll: boolean;
    /** 是否已落盘 */
    wrote: boolean;
    /** 摘要 */
    summary: string;
}

/**
 * 场景循环正文生成服务。
 */
export class SceneLoopBodyService {
    /**
     * @param app - Obsidian 应用
     * @param deps - 编排依赖
     */
    constructor(
        private readonly app: App,
        private readonly deps: SceneLoopBodyDeps,
    ) {}

    /**
     * 逐场生成一章正文。
     *
     * @param project - 项目路径
     * @param chapterName - 章节名
     * @param options - 选项
     * @returns 生成结果
     */
    async generate(
        project: string,
        chapterName: string,
        options: { dryRun?: boolean; allowPartial?: boolean } = {},
    ): Promise<SceneLoopBodyResult> {
        const dryRun = options.dryRun !== false;
        const scenePath = await this.deps.findBySuffix(project, `${chapterName}_Scene展开`);
        if (!scenePath) {
            return { dryRun, scenes: 0, failedScenes: [], body: '', chars: 0, completedAll: false, wrote: false, summary: '没有 Scene 展开，无法逐场生成' };
        }
        const expansionText = await this.deps.readText(scenePath);
        if (!expansionText.trim()) {
            return { dryRun, scenes: 0, failedScenes: [], body: '', chars: 0, completedAll: false, wrote: false, summary: 'Scene 展开为空' };
        }

        const loop = await this.deps.runLoop(expansionText);
        const bodies = loop.scenes
            .map(scene => String(scene.body ?? '').trim())
            .filter(Boolean);
        const body = this.mergeBodies(bodies);
        const failedScenes = loop.failedScenes.map(failure => failure.task.num);
        const completedAll = loop.completedAll && failedScenes.length === 0;

        if (!dryRun) {
            const canWrite = completedAll || options.allowPartial === true;
            if (canWrite && body.trim()) {
                await this.deps.writeBody(project, chapterName, body);
            }
        }

        const summary = `逐场生成：成功 ${loop.scenes.length} 场/${bodies.length} 段正文${failedScenes.length > 0 ? `，失败 ${failedScenes.length} 场（第${failedScenes.join('、')}场）` : ''}，共 ${body.length} 字`;
        log.info(`[${chapterName}] ${summary}${dryRun ? '（预览未落盘）' : ''}`);
        return {
            dryRun,
            scenes: loop.scenes.length,
            failedScenes,
            body,
            chars: body.length,
            completedAll,
            wrote: !dryRun && (completedAll || options.allowPartial === true) && body.trim().length > 0,
            summary,
        };
    }

    /**
     * 合并场景正文：段间双空行，去重相邻重复段（模型偶尔会重复结尾）。
     *
     * @param bodies - 各场正文
     * @returns 合并正文
     */
    mergeBodies(bodies: readonly string[]): string {
        const cleaned: string[] = [];
        for (const raw of bodies) {
            const text = String(raw ?? '').trim();
            if (!text) continue;
            const previous = cleaned[cleaned.length - 1];
            if (previous && (previous.endsWith(text) || text.startsWith(previous))) {
                continue;
            }
            cleaned.push(text);
        }
        return cleaned.join(SCENE_SEPARATOR);
    }

    /**
     * 找本章 Scene 展开路径（供调用方诊断）。
     *
     * @param project - 项目路径
     * @param chapterName - 章节名
     * @returns 路径或 null
     */
    async findScenePath(project: string, chapterName: string): Promise<string | null> {
        return this.deps.findBySuffix(project, `${chapterName}_Scene展开`);
    }

    /**
     * 读场景展开原文（供插件侧组装提示词）。
     *
     * @param project - 项目路径
     * @param chapterName - 章节名
     * @returns 文本
     */
    async readSceneExpansion(project: string, chapterName: string): Promise<string> {
        const path = await this.findScenePath(project, chapterName);
        return path ? this.deps.readText(path) : '';
    }

    /**
     * 便捷构造：从 vault 读文件 + 找文件。
     *
     * @param app - Obsidian 应用
     * @param runLoop - 场景循环执行器
     * @param writeBody - 正文落盘
     * @returns 服务实例
     */
    static fromVault(
        app: App,
        runLoop: SceneLoopBodyDeps['runLoop'],
        writeBody: SceneLoopBodyDeps['writeBody'],
    ): SceneLoopBodyService {
        const readText = async (path: string): Promise<string> => {
            const file = app.vault.getAbstractFileByPath(path);
            if (!(file instanceof TFile)) return '';
            try {
                return await app.vault.read(file);
            } catch { // silent-ok: 单文件读失败按空处理
                return '';
            }
        };
        const findBySuffix = async (project: string, suffix: string): Promise<string | null> => {
            const root = app.vault.getAbstractFileByPath(project);
            if (!(root instanceof TFolder)) return null;
            const stack: TFolder[] = [root];
            while (stack.length > 0) {
                const current = stack.pop();
                if (!current) continue;
                for (const child of current.children) {
                    if (child instanceof TFolder) stack.push(child);
                    else if (child instanceof TFile && child.extension === 'md' && child.basename.endsWith(suffix)) return child.path;
                }
            }
            return null;
        };
        return new SceneLoopBodyService(app, { runLoop, readText, writeBody, findBySuffix });
    }
}
