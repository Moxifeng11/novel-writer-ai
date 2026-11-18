/**
 * verify-flows-lib.mjs — verify-three-flows.mjs 的镜像判定库（残余技术债闭合）
 *
 * 历史背景：判定函数按行镜像 `shared/link-status-compute.ts`（.mjs 不能 import TS），
 * 镜像体此前内联在 `scripts/verify-three-flows.mjs` 里。抽到这里之后：
 *  - vitest 可以**直接 import 真源（shared）与本库**做逐分支 parity 对比
 *    （tests/unit/scripts/verify-flows-parity.test.ts）——镜像漂移从「人工 diff」
 *    变成「跑测试就红」；
 *  - 脚本本体只保留采集/报告/退出码语义。
 *
 * 纪律不变：**语义变更必须两边同步**（shared 为唯一事实源，本库是运行层镜像），
 * 每个函数上方保留 `@mirror` 锚点。
 *
 * @mirror 行号锚点不写死——parity 测试按输出对比，行号漂移无害。
 */

/**
 * @mirror shared/link-status-compute.ts#summarizeLink
 */
export function summarizeLink(titleKey, stages, degradations) {
    const firstBroken = stages.find(stage => stage.status === 'broken');
    const hasWarn = stages.some(stage => stage.status === 'warn');
    const decidable = stages.filter(stage => stage.status !== 'unknown');
    const hasDegradation = Boolean(degradations && degradations.length > 0);
    const overall = firstBroken
        ? 'broken'
        : hasWarn || hasDegradation
            ? 'warn'
            : decidable.length === 0
                ? 'unknown'
                : 'ok';
    return {

        titleKey,
        stages,
        overall,
        breakpointKey: firstBroken ? firstBroken.nameKey : null,
        degradations,
    };
}

/**
 * @mirror shared/link-status-compute.ts#computeKnowledgeFlowStatus
 * DSH-20261112-17：orphanCount>0 时「检索」环节降为 warn 并在 detail 附注孤儿数（环节级呈现）。
 */
export function computeKnowledgeFlowStatus(input) {
    const breakdown = input.breakdownCompleted > 0
        ? { nameKey: 'linkStatus.stage.breakdown', status: 'ok', detailKey: 'linkStatus.detail.breakdownOk', detailParams: { count: input.breakdownCompleted } }
        : input.bookTotal > 0
            ? { nameKey: 'linkStatus.stage.breakdown', status: 'broken', detailKey: 'linkStatus.detail.breakdownAllPending', detailParams: { count: input.bookTotal } }
            : { nameKey: 'linkStatus.stage.breakdown', status: 'unknown', detailKey: 'linkStatus.detail.breakdownEmpty' };

    const vectorize = input.vectorDone > 0
        ? {
            nameKey: 'linkStatus.stage.vectorize',
            status: input.vectorFailed > 0 ? 'warn' : 'ok',
            detailKey: input.vectorFailed > 0 ? 'linkStatus.detail.vectorizePartial' : 'linkStatus.detail.vectorizeOk',
            detailParams: input.vectorFailed > 0
                ? { ok: input.vectorDone, failed: input.vectorFailed }
                : { ok: input.vectorDone },
        }
        : input.breakdownCompleted > 0
            ? {
                nameKey: 'linkStatus.stage.vectorize',
                status: 'broken',
                detailKey: input.vectorFailed > 0 ? 'linkStatus.detail.vectorizeAllFailed' : 'linkStatus.detail.vectorizeMissing',
                detailParams: input.vectorFailed > 0 ? { failed: input.vectorFailed } : undefined,
            }
            : { nameKey: 'linkStatus.stage.vectorize', status: 'unknown', detailKey: 'linkStatus.detail.vectorizeWaiting' };

    const embeddingStage = input.embeddingReady
        ? { nameKey: 'linkStatus.stage.embedding', status: 'ok', detailKey: 'linkStatus.detail.embeddingOk' }
        : {
            nameKey: 'linkStatus.stage.embedding',
            status: 'broken',
            detailKey: 'linkStatus.detail.embeddingBroken',
        };

    const storeReady = input.storeReady !== false;
    const retrieve = !storeReady
        ? { nameKey: 'linkStatus.stage.retrieve', status: 'unknown', detailKey: 'linkStatus.detail.retrieveNotLoaded' }
        : input.storeLoadedBooks > 0
            ? {
                nameKey: 'linkStatus.stage.retrieve',
                status: input.orphanCount ? 'warn' : 'ok',
                detailKey: input.orphanCount ? 'linkStatus.detail.retrieveLoadedWithOrphans' : 'linkStatus.detail.retrieveLoaded',
                detailParams: input.orphanCount
                    ? { count: input.storeLoadedBooks, orphans: input.orphanCount }
                    : { count: input.storeLoadedBooks },
            }
            : input.vectorDone > 0
                ? {
                    nameKey: 'linkStatus.stage.retrieve',
                    status: 'broken', detailKey: 'linkStatus.detail.retrieveStoreEmpty',
                }
                : { nameKey: 'linkStatus.stage.retrieve', status: 'broken', detailKey: 'linkStatus.detail.retrieveEmpty' };

    const attribute = {
        nameKey: 'linkStatus.stage.attribute',
        status: 'unknown', detailKey: 'linkStatus.detail.attributeTodo',
    };

    return summarizeLink('linkStatus.title.knowledge', [breakdown, vectorize, embeddingStage, retrieve, attribute], input.degradations);
}

/**
 * @mirror shared/link-status-compute.ts#computeStyleFlowStatus
 */
export function computeStyleFlowStatus(input) {
    const total = input.templateCount + input.globalCount + input.projectCount;
    const injectable = input.globalCount + input.projectCount;

    const library = total > 0
        ? {
            nameKey: 'linkStatus.stage.fingerprintLib',
            status: injectable > 0 ? 'ok' : 'warn',
            detailKey: injectable > 0 ? 'linkStatus.detail.fpInjectable' : 'linkStatus.detail.fpTemplateOnly',
            detailParams: injectable > 0
                ? { count: injectable, templates: input.templateCount }
                : { templates: input.templateCount },
        }
        : { nameKey: 'linkStatus.stage.fingerprintLib', status: 'unknown', detailKey: 'linkStatus.detail.fpEmpty' };

    const enabled = input.enabledCount > 0
        ? { nameKey: 'linkStatus.stage.enabled', status: 'ok', detailKey: 'linkStatus.detail.enabledOk', detailParams: { count: input.enabledCount } }
        : injectable > 0
            ? { nameKey: 'linkStatus.stage.enabled', status: 'broken', detailKey: 'linkStatus.detail.enabledNone' }
            : { nameKey: 'linkStatus.stage.enabled', status: 'unknown', detailKey: 'linkStatus.detail.enabledWaiting' };

    const intensity = input.enabledCount === 0
        ? { nameKey: 'linkStatus.stage.intensity', status: 'unknown', detailKey: 'linkStatus.detail.waitingEnabled' }
        : input.enabledCount - input.intensityDisabledCount > 0
            ? {
                nameKey: 'linkStatus.stage.intensity',
                status: input.intensityDisabledCount > 0 ? 'warn' : 'ok',
                detailKey: input.intensityDisabledCount > 0 ? 'linkStatus.detail.intensityPartialZero' : 'linkStatus.detail.intensityAllPositive',
                detailParams: input.intensityDisabledCount > 0 ? { count: input.intensityDisabledCount } : undefined,
            }
            : { nameKey: 'linkStatus.stage.intensity', status: 'broken', detailKey: 'linkStatus.detail.intensityZero' };

    const inject = input.enabledCount === 0
        ? { nameKey: 'linkStatus.stage.inject', status: 'unknown', detailKey: 'linkStatus.detail.waitingEnabled' }
        : input.enabledCount - input.intensityDisabledCount > 0
            ? {
                nameKey: 'linkStatus.stage.inject',
                status: input.embeddingReady ? 'ok' : 'warn',
                detailKey: input.embeddingReady ? 'linkStatus.detail.styleInjectOk' : 'linkStatus.detail.styleInjectNoEmbedding',
            }
            : { nameKey: 'linkStatus.stage.inject', status: 'broken', detailKey: 'linkStatus.detail.intensityZero' };

    return summarizeLink('linkStatus.title.style', [library, enabled, intensity, inject], input.degradations);
}

/**
 * @mirror shared/link-status-compute.ts#computeConstraintFlowStatus
 */
export function computeConstraintFlowStatus(input) {
    const research = input.sourceCount > 0
        ? { nameKey: 'linkStatus.stage.research', status: 'ok', detailKey: 'linkStatus.detail.researchOk', detailParams: { count: input.sourceCount } }
        : { nameKey: 'linkStatus.stage.research', status: 'warn', detailKey: 'linkStatus.detail.researchMissing' };

    const setting = input.settingExists
        ? { nameKey: 'linkStatus.stage.setting', status: 'ok', detailKey: 'linkStatus.detail.settingOk' }
        : { nameKey: 'linkStatus.stage.setting', status: 'broken', detailKey: 'linkStatus.detail.settingMissing' };

    const review = input.reviewStatus === 'approved'
        ? { nameKey: 'linkStatus.stage.review', status: 'ok', detailKey: 'linkStatus.detail.reviewApproved' }
        : input.reviewStatus === 'legacy'
            ? { nameKey: 'linkStatus.stage.review', status: 'warn', detailKey: 'linkStatus.detail.reviewLegacy' }
            : input.reviewStatus === 'pending'
                ? { nameKey: 'linkStatus.stage.review', status: 'broken', detailKey: 'linkStatus.detail.reviewPending' }
                : input.reviewStatus === 'rejected'
                    ? { nameKey: 'linkStatus.stage.review', status: 'broken', detailKey: 'linkStatus.detail.reviewRejected' }
                    : { nameKey: 'linkStatus.stage.review', status: 'unknown', detailKey: 'linkStatus.detail.reviewNone' };

    const bind = input.bound
        ? { nameKey: 'linkStatus.stage.bind', status: 'ok', detailKey: 'linkStatus.detail.bindOk' }
        : input.settingExists
            ? { nameKey: 'linkStatus.stage.bind', status: 'broken', detailKey: 'linkStatus.detail.bindMissing' }
            : { nameKey: 'linkStatus.stage.bind', status: 'unknown', detailKey: 'linkStatus.detail.bindWaiting' };

    const inject = !input.bound
        ? { nameKey: 'linkStatus.stage.inject', status: 'unknown', detailKey: 'linkStatus.detail.constraintInjectWaiting' }
        : input.rulesHasContent
            ? { nameKey: 'linkStatus.stage.inject', status: 'ok', detailKey: 'linkStatus.detail.constraintInjectOk' }
            : { nameKey: 'linkStatus.stage.inject', status: 'broken', detailKey: 'linkStatus.detail.constraintInjectPlaceholder' };

    return summarizeLink('linkStatus.title.constraint', [research, setting, review, bind, inject], input.degradations);
}

/**
 * @mirror shared/paths.ts#sanitizeName（技术债闭合，DSH-20261112-17）
 *
 * 真实实现的净化链逐行镜像：控制字符删除 → 文件系统保留字替换下划线 →
 * trim → 去首尾点 → 空回落「未命名」。
 */
export function mirrorSanitizeName(name) {
    // 逐行镜像：shared 版对 undefined 会抛错（签名就是 string），镜像必须同语义——
    // parity 测试按「同输入同输出」对比，防御性差异本身也是一种漂移。
    const cleaned = name
        .replace(/[\u0000-\u001f\u007f]/g, '')
        .replace(/[\\/:*?"<>|]/g, '_')
        .trim()
        .replace(/^\.+/, '')
        .replace(/\.+$/, '');
    return cleaned || '未命名';
}
