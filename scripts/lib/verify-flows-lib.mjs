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
export function summarizeLink(title, stages, degradations) {
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
        title,
        stages,
        overall,
        breakpoint: firstBroken ? firstBroken.name : null,
        degradations,
    };
}

/**
 * @mirror shared/link-status-compute.ts#computeKnowledgeFlowStatus
 * DSH-20261112-17：orphanCount>0 时「检索」环节降为 warn 并在 detail 附注孤儿数（环节级呈现）。
 */
export function computeKnowledgeFlowStatus(input) {
    const breakdown = input.breakdownCompleted > 0
        ? { name: '拆解', status: 'ok', detail: `${input.breakdownCompleted} 本已拆解` }
        : input.bookTotal > 0
            ? { name: '拆解', status: 'broken', detail: `${input.bookTotal} 本已导入但都未完成拆解` }
            : { name: '拆解', status: 'unknown', detail: '知识库为空' };

    const vectorize = input.vectorDone > 0
        ? {
            name: '向量化',
            status: input.vectorFailed > 0 ? 'warn' : 'ok',
            detail: input.vectorFailed > 0
                ? `${input.vectorDone} 本就绪，${input.vectorFailed} 本失败`
                : `${input.vectorDone} 本就绪`,
        }
        : input.breakdownCompleted > 0
            ? {
                name: '向量化',
                status: 'broken',
                detail: input.vectorFailed > 0
                    ? `${input.vectorFailed} 本全部失败（检查嵌入模型配置）`
                    : '已拆解但没有可用向量（检查嵌入模型）',
            }
            : { name: '向量化', status: 'unknown', detail: '等待拆解完成' };

    const embeddingStage = input.embeddingReady
        ? { name: '嵌入模型', status: 'ok', detail: input.embeddingDetail || '可用' }
        : {
            name: '嵌入模型',
            status: 'broken',
            detail: input.embeddingDetail || '不可用（检索会退化为关键词匹配）',
        };

    const storeReady = input.storeReady !== false;
    const retrieve = !storeReady
        ? { name: '检索', status: 'unknown', detail: '向量库尚未加载，暂时无法判定' }
        : input.storeLoadedBooks > 0
            ? {
                name: '检索',
                status: input.orphanCount ? 'warn' : 'ok',
                detail: `向量库已加载 ${input.storeLoadedBooks} 本${input.orphanCount ? `（其中 ${input.orphanCount} 本不在知识库索引，建议对账清理）` : ''}`,
            }
            : input.vectorDone > 0
                ? {
                    name: '检索',
                    status: 'broken',
                    detail: '状态显示向量就绪，但向量库里没有数据（可能文件丢失，建议重向量化）',
                }
                : { name: '检索', status: 'broken', detail: '向量库为空，检索无结果' };

    const attribute = {
        name: '归因',
        status: 'unknown',
        detail: '写作后可在统计页核对 rag_sources',
    };

    return summarizeLink('知识流', [breakdown, vectorize, embeddingStage, retrieve, attribute], input.degradations);
}

/**
 * @mirror shared/link-status-compute.ts#computeStyleFlowStatus
 */
export function computeStyleFlowStatus(input) {
    const total = input.templateCount + input.globalCount + input.projectCount;
    const injectable = input.globalCount + input.projectCount;

    const library = total > 0
        ? {
            name: '指纹库',
            status: injectable > 0 ? 'ok' : 'warn',
            detail: injectable > 0
                ? `可注入 ${injectable}（另有模板 ${input.templateCount} 仅作来源）`
                : `只有模板层 ${input.templateCount}（模板不参与注入，需复制到项目）`,
        }
        : { name: '指纹库', status: 'unknown', detail: '还没有指纹' };

    const enabled = input.enabledCount > 0
        ? { name: '启用', status: 'ok', detail: `${input.enabledCount} 枚已启用` }
        : injectable > 0
            ? { name: '启用', status: 'broken', detail: '指纹已存在但全部未启用' }
            : { name: '启用', status: 'unknown', detail: '等待创建指纹' };

    const intensity = input.enabledCount === 0
        ? { name: '强度', status: 'unknown', detail: '等待启用指纹' }
        : input.enabledCount - input.intensityDisabledCount > 0
            ? {
                name: '强度',
                status: input.intensityDisabledCount > 0 ? 'warn' : 'ok',
                detail: input.intensityDisabledCount > 0
                    ? `${input.intensityDisabledCount} 枚强度为 0（等于禁用）`
                    : '全部 > 0',
            }
            : { name: '强度', status: 'broken', detail: '所有启用指纹强度都是 0，注入被禁用' };

    const inject = input.enabledCount === 0
        ? { name: '注入', status: 'unknown', detail: '等待启用指纹' }
        : input.enabledCount - input.intensityDisabledCount > 0
            ? {
                name: '注入',
                status: input.embeddingReady ? 'ok' : 'warn',
                detail: input.embeddingReady
                    ? '特征与示例都会注入'
                    : '特征可注入；嵌入不可用，向量筛选/示例检索不可用',
            }
            : { name: '注入', status: 'broken', detail: '所有启用指纹强度都是 0，注入被禁用' };

    return summarizeLink('风格流', [library, enabled, intensity, inject], input.degradations);
}

/**
 * @mirror shared/link-status-compute.ts#computeConstraintFlowStatus
 */
export function computeConstraintFlowStatus(input) {
    const research = input.sourceCount > 0
        ? { name: '考据', status: 'ok', detail: `${input.sourceCount} 条来源` }
        : { name: '考据', status: 'warn', detail: '没有官方来源，设定只能写「待核实」' };

    const setting = input.settingExists
        ? { name: '设定', status: 'ok', detail: '文件存在' }
        : { name: '设定', status: 'broken', detail: '还没有同人设定文件' };

    const review = input.reviewStatus === 'approved'
        ? { name: '审核', status: 'ok', detail: '已通过人工审核' }
        : input.reviewStatus === 'legacy'
            ? { name: '审核', status: 'warn', detail: '旧文件无审核记录，建议重新审核' }
            : input.reviewStatus === 'pending'
                ? { name: '审核', status: 'broken', detail: '待审核，不能绑定到项目' }
                : input.reviewStatus === 'rejected'
                    ? { name: '审核', status: 'broken', detail: '已驳回，不能绑定到项目' }
                    : { name: '审核', status: 'unknown', detail: '没有可审核的设定' };

    const bind = input.bound
        ? { name: '绑定', status: 'ok', detail: '已绑定到当前项目' }
        : input.settingExists
            ? { name: '绑定', status: 'broken', detail: '设定未绑定到项目，写作时读不到' }
            : { name: '绑定', status: 'unknown', detail: '等待设定文件' };

    const inject = !input.bound
        ? { name: '注入', status: 'unknown', detail: '等待绑定' }
        : input.rulesHasContent
            ? { name: '注入', status: 'ok', detail: '约束会进入 prompt' }
            : { name: '注入', status: 'broken', detail: '绑定的设定没有实质内容（全是占位）' };

    return summarizeLink('约束流', [research, setting, review, bind, inject], input.degradations);
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
