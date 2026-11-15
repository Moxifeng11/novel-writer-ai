/**
 * scene-context-service.ts — 场景上下文包编排
 *
 * 把 M4/M5 的纯函数串成一次调用：
 * Scene 展开 → 解析场景 → 在场名称 → 精确解析 ID → 覆盖要求 → 迭代装配 → 渲染段落。
 *
 * 供正文/质控/分析步直接调用（后续 M5 接线只需替换变量注入点）。
 */

import { createLogger } from '@/shared/logger';
import type { ContextSessionService, ContextAssemblyResult } from './context-session-service';
import type { ProjectIndexService } from './project-index-service';
import {
    buildSceneRequirements,
    describeSceneAnchor,
    parseSceneAnchors,
    resolveAnchorIds,
    type SceneAnchor,
} from '@/shared/scene-anchor-model';
import { renderSceneContextSection } from '@/shared/scene-context-prompt';
import { createContextSession, type ContextSession } from '@/shared/context-session-model';

const log = createLogger('SceneContext');

/** 场景上下文包 */
export interface SceneContextPack {
    /** 选中的场景 */
    scene: SceneAnchor | null;
    /** 会话（已加载条目） */
    session: ContextSession;
    /** 装配结果 */
    assembly: ContextAssemblyResult;
    /** 渲染好的提示词段落 */
    section: string;
    /** 未能解析的名称 */
    unresolved: string[];
    /** 多义名称（需用户/模型选择） */
    ambiguous: string[];
    /** 场景总数 */
    sceneCount: number;
}

/**
 * 场景上下文服务。
 */
export class SceneContextService {
    /**
     * @param indexService - 项目索引服务
     * @param sessionService - 上下文装配服务
     */
    constructor(
        private readonly indexService: ProjectIndexService,
        private readonly sessionService: ContextSessionService,
    ) {}

    /**
     * 构建场景上下文包。
     *
     * @param project - 项目路径
     * @param sceneExpandText - 「Scene 展开」全文
     * @param sceneIndex - 目标场景序号（1 起；越界时取最后一个）
     * @param options - 预算与是否含摘要
     * @returns 上下文包
     */
    async build(
        project: string,
        sceneExpandText: string,
        sceneIndex: number,
        options: { maxTokens?: number; includeSummary?: boolean } = {},
    ): Promise<SceneContextPack> {
        const scenes = parseSceneAnchors(sceneExpandText);
        if (scenes.length === 0) {
            return this.emptyPack();
        }
        const index = Math.max(1, Math.min(Math.floor(sceneIndex || 1), scenes.length));
        const scene = scenes[index - 1];
        const entries = (await this.indexService.ensure(project)).entries;
        const resolved = resolveAnchorIds(entries, scene.names);
        const requirements = buildSceneRequirements(scene, resolved, entries);

        let session = createContextSession({
            sceneId: `SCENE-${scene.index}`,
            anchorIds: resolved.ids,
            chapterSegment: scene.body.slice(0, 4000),
            maxTokens: options.maxTokens,
        });
        const assembly = await this.sessionService.assemble(project, session, requirements);
        session = assembly.session;

        const section = renderSceneContextSection(session, {
            scene,
            coverage: assembly.coverage,
            includeSummary: options.includeSummary,
        });
        log.info(`场景上下文：${describeSceneAnchor(scene)}，已加载 ${Object.keys(session.loaded).length} 条，缺 ${assembly.coverage.missing.length} 条`);

        return {
            scene,
            session,
            assembly,
            section,
            unresolved: resolved.unresolved,
            ambiguous: resolved.ambiguous,
            sceneCount: scenes.length,
        };
    }

    private emptyPack(): SceneContextPack {
        const session = createContextSession({});
        return {
            scene: null,
            session,
            assembly: {
                session,
                coverage: { required: 0, loaded: 0, missing: [] },
                pending: [],
                budgetExhausted: false,
            },
            section: '',
            unresolved: [],
            ambiguous: [],
            sceneCount: 0,
        };
    }
}
