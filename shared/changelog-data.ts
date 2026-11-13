/**
 * changelog-data.ts — 内置更新日志数据
 *
 * 包含最近几个版本的更新日志，用于在模态框中显示。
 * 格式：版本号 + 日期 + 分类（新增/优化/修复/破坏性变更）
 */

export interface ChangelogEntry {
    version: string;
    date: string;
    title: string;
    sections: {
        type: 'added' | 'improved' | 'fixed' | 'breaking';
        label: string;
        items: string[];
    }[];
}

/**
 * BUILTIN_CHANGELOG 常量。
 */
export const BUILTIN_CHANGELOG: ChangelogEntry[] = [
    {
        version: '4.89.0',
        date: '2026-11-13',
        title: '知识库事实层：让正则功能有"第二意见"',
        sections: [
            {
                type: 'added',
                label: '📚 知识库事实层',
                items: [
                    'LLM 拆解正文为结构化事实（主体·谓词·值·有效区间·原文引文），落盘可人工修正',
                    '时间线/实体状态/伏笔三类功能改为「正则找候选 → 查事实库定结论」',
                    '低置信矛盾交 LLM 语义判定，判定失败保留规则结果不丢矛盾',
                ],
            },
            {
                type: 'fixed',
                label: '🛠️ 修复',
                items: [
                    '无章节摘要的项目此前 0 产出，现按正文目录枚举并显式告警',
                    '新增 check:command-handlers 门禁，拦「命令执行但无反应」',
                ],
            },
        ],
    },
    {
        version: '4.88.0',
        date: '2026-11-13',
        title: '一致性审核闭环：19 子类全覆盖 + 结算自动兜底',
        sections: [
            {
                type: 'added',
                label: '🔍 一致性审核',
                items: [
                    '19/19 子类全覆盖：新增记忆矛盾、核心规则违规、视角混乱等 10 类',
                    '结算后自动跑规则层（零 token），有疑似项才启 AI 识别（封顶 3 对）',
                    '发现跨章矛盾主动提示，不必再去点命令',
                ],
            },
            {
                type: 'fixed',
                label: '🛠️ 修复',
                items: [
                    'rename 覆盖类问题全仓排查（4 处），含知识库索引第二次起写不进去',
                    '修正 3 处「测试锁住错误行为」的旧断言',
                ],
            },
        ],
    },
    {
        version: '4.87.0',
        date: '2026-11-13',
        title: '跨章一致性审核：从"写得好不好"到"前后对不对"',
        sections: [
            {
                type: 'added',
                label: '🔍 一致性审核',
                items: [
                    '跨章检测 9 类矛盾（命名混淆/数量不符/外貌不符/绝对时间/时长/同时性/无因之果/因果违规/废弃情节）',
                    '每条问题带双侧原文引文与正文字符位置，可一键跳到正文',
                    '规则层零 token 全量跑，仅疑似项交模型复核（默认上限 10 对）',
                    '风险定位：中段加权 + 字符熵 + 罕见字密度，只挑高风险段',
                    'CED 指标（每万字符错误数）用于跨版本比较',
                ],
            },
            {
                type: 'fixed',
                label: '🛠️ 修复',
                items: [
                    '原子写 rename 覆盖已存在文件抛错，导致第二次起写入全失败',
                    '字数统计台账同款问题，导致统计永不持久化',
                    '命令执行体缺失静默失效；新增门禁 check:command-handlers 防复发',
                ],
            },
        ],
    },
    {
        version: '4.86.0',
        date: '2026-11-13',
        title: '静默失败门禁 + 生产环境测试闭环',
        sections: [
            {
                type: 'fixed',
                label: '🔴 AI 调用',
                items: [
                    'AI 调用全线失败修复（high）：密钥在 providerKeys 而 apiKey 为空时，所有调用返回「API密钥未配置」；统一回退取值（非流式/流式/迭代器）',
                    '项目创建关键写入失败不再谎报成功：.project 写入 / 覆盖删除 / 同人设定复制失败改为中止创建',
                ],
            },
            {
                type: 'added',
                label: '🛡️ 门禁与测试',
                items: [
                    '新增门禁 check:silent-failures：识别「读失败当没有 / 写失败当成功」，基线 191 处只降不升（检测先剥注释与字符串，消除 121 处假阳性）',
                    '新增 npm run check:prod：真实 Obsidian + 真实 AI 一键冒烟（6 步，含版本一致性与流式调用）',
                ],
            },
        ],
    },
    {
        version: '4.85.0',
        date: '2026-11-13',
        title: '静默失效大扫除：27 处真 bug + 测试标准',
        sections: [
            {
                type: 'fixed',
                label: '🎯 同人约束',
                items: [
                    '修 5 处「用 vault 索引 API 读 .project」——点文件不入索引，同人约束此前全线静默失效且不报警',
                    '向导的「故事结构」「同人」步骤不再永远判为未完成',
                ],
            },
            {
                type: 'fixed',
                label: '💾 数据安全',
                items: [
                    '修 5 处「读失败→空→覆盖写」：自定义题材/标签、质量历史、简介版本、风格偏好、整章正文不再被静默抹掉',
                    '损坏文件先留档为 .corrupt-<时间戳>，可人工抢救',
                ],
            },
            {
                type: 'fixed',
                label: '🌊 流式 / 拆解 / 指纹 / 导出结算',
                items: [
                    '流被截断不再当成功、重试不再导致正文两轮拼接、协议错误帧不再被当成正常结束',
                    '拆解维度失败不再算完成、不再弹「拆解完成 100%」',
                    '指纹保存/删除/启停/强度/迁移不再「提示成功但重启回滚」',
                    'EPUB 投稿简介与平台标签不再丢失；结算静默漏写路径全部可见化',
                    '向量落盘失败不再谎报「向量化完成」',
                ],
            },
            {
                type: 'improved',
                label: '🧪 工程',
                items: [
                    '新增测试标准：7 条硬规则 + 生产环境测试三层矩阵 + 发版前 10 条手工验收清单',
                    '新增门禁 check:test-standard（禁止 .only / 无理由 .skip / 空断言 / 替身不忠实）',
                ],
            },
        ],
    },
    {
        version: '4.84.0',
        date: '2026-11-12',
        title: '自愈版本：agent 能修了 + 孤儿向量对账 + 假绿修复',
        sections: [
            {
                type: 'added',
                label: '🔧 agent 自愈',
                items: [
                    'repair_flow 从 2 个动作扩到 6 个：重向量化 / 指纹重载 / 孤儿清理 / 强度修复 / 磁盘向量清理 / 考据重跑',
                    '修复动作全部走审批且 fail-closed（无审批回调一律拒绝），失败如实报错不静默成功',
                    '修复结果进会话遥测：agent 事后能自证「修过什么、修成了没有」',
                ],
            },
            {
                type: 'fixed',
                label: '🧹 假绿修复',
                items: [
                    '孤儿向量对账：知识库索引为空但向量库有数据时，界面不再显示「已加载 1 本」而装作正常',
                    '清理不静默：未确认一个不删，整轮清理放在单次写锁内',
                    '降级提示改为只显示最近 3 条（原来取的是最旧三条，与「最近」语义相反）',
                ],
            },
            {
                type: 'improved',
                label: '📈 其他',
                items: [
                    'repair_flow 接入工作台：诊断出的断点可以一键修复',
                    '示例项目种子脚本：可在临时目录生成最小真实数据集，让三条链路可被真实验证',
                    '覆盖率：ui 15.22% → 20.43%，ui/views 12.95% → 28.26%',
                ],
            },
        ],
    },
    {
        version: '4.83.1',
        date: '2026-11-12',
        title: '可验证版本：三条链路自证 + 静默失效修复 + 门禁加固',
        sections: [
            {
                type: 'added',
                label: '✅ 链路自证',
                items: [
                    '三条数据流端到端测试（知识 / 风格 / 约束）与三界面链路状态区块，断点与降级可见',
                    'diagnose_flow 自诊断工具与界面共用同一份判定逻辑，agent 能回答「为什么没生效」',
                ],
            },
            {
                type: 'fixed',
                label: '🛠 静默失效',
                items: [
                    'RAG 空 bookIds 被当成「一个都不要」，改为空 = 不限制范围',
                    '向量化 samples 为空时如实标记 failed，不再假成功',
                    '嵌入不可用时关键词兜底；指纹首跑自愈；同人审核闸门不再被向导绕过',
                ],
            },
            {
                type: 'improved',
                label: '🚦 门禁与协作',
                items: [
                    '新增覆盖率棘轮 check:coverage（ui 14.71% / ui/views 8.14% 首期基线）',
                    'check:obsidian-api 空扫描假通过与 check:view-tests 假阳性修复',
                    '信箱三元身份 + 文件系统任务板（原子领取 / 写范围租约）',
                ],
            },
        ],
    },
    {
        version: '4.83.0',
        date: '2026-11-11',
        title: '治理版本：包体积回血 + UI 可测性 + 安全 r3 收尾',
        sections: [
            {
                type: 'improved',
                label: '📦 包体积治理',
                items: [
                    '内置更新日志从 94 个版本裁到最近 12 个，完整历史仍可经弹窗 footer 外链查看（-56KB）',
                    '支付宝收款码由 39KB JPEG 换为 12KB 自适应调色板 PNG，扫码对比度不变（-27KB）',
                    'main.js 4,964,531 → 4,875,600 B，距 5 MB 上限余量由 0.7% 提升到 2.5%',
                ],
            },
            {
                type: 'improved',
                label: '🧪 可测性',
                items: [
                    '从知识库与书籍详情视图抽出 6 个纯逻辑模块（格式化/筛选排序/状态映射/统计聚合/任务面板/卡片判定）',
                    '新增 163 条单测；抽出模块覆盖率 95.65%–100%，其中 3 个达 100%',
                    '筛选规则抽取时用 300 组随机数据做过新旧实现差分验证',
                ],
            },
            {
                type: 'fixed',
                label: '🔒 安全 r3 收尾（S3-17 ~ S3-21）',
                items: [
                    'Agent「移动文件」不再允许跨项目搬运，避免项目身份文件被搬走后项目凭空消失',
                    '会话大结果溢出目录与会话作用域统一，修复切换项目后模型读不回自己落盘原文的问题',
                    '会话恢复只接受白名单记忆项并限制事件条数，防篡改存档预置上下文',
                    '章节文件名 helper 内部净化标题，不再依赖调用方',
                    '考据抓取拒绝把 3xx/4xx 中间页当正文（重定向复核需上游支持，如实记录为残余）',
                ],
            },
            {
                type: 'added',
                label: '🚦 门禁',
                items: [
                    '新增视图测试下限门禁：超过 200 行的 UI 文件必须被测试引用，存量登记为棘轮基线',
                ],
            },
        ],
    },
    {
        version: '4.82.0',
        date: '2026-11-11',
        title: '安全加固 r3 收口 + 上下文/记忆/一致性三链落地',
        sections: [
            {
                type: 'added',
                label: '🆕 新增',
                items: [
                    '上下文预算计划与抽取式压缩：超限显式报错，不再静默截断',
                    '故事台账单源化：章节引用、实体索引、属性标签与增量关系 5 维',
                    '只读故事一致性校验与结算后触发；人物一致性统一规则接入门禁与看板',
                    '调用时关联查询接入步骤/协同/单元，记忆新增待确认队列与章节摘要',
                ],
            },
            {
                type: 'improved',
                label: '✨ 优化',
                items: [
                    '协同写作本地模式未选本地模型时自动切云端，并区分「已自动切换」提示',
                    '移动端 requestUrl 兜底传输、热重载状态交接、.bak 明文形态文案如实',
                    '知识库/指纹库补能力边界说明，检索向量范数缓存、弹窗边界收口',
                    '多窗口：主题/字体/拖拽按宿主 Document 注入，浮窗触屏拖动与窄视口夹取',
                ],
            },
            {
                type: 'fixed',
                label: '🐛 修复',
                items: [
                    '安全 r3（S3-1~S3-16）：外部文本统一围栏、official 来源去标题化、密文禁止出网、dsh env 凭据剔除、run_command 显式目标、删除/移动类确认不可逆、路径 helper 拒绝穿越与原型污染',
                    '一致性（D3-4~D3-18）：上下文注入锁内重读、结算回写加锁、版本索引损坏归档、信息债看板统一写入器',
                    '稳定性（L2-1/L3-1/M3-x）：卸载有界等待视图保存、onOpen 代次守卫、移除 Obsidian 私有插件表访问',
                    '项目改名禁止移出 vault；一键成文不再把 settled 改回 written；迁移旧版双拼插件数据目录',
                ],
            },
        ],
    },
    {
        version: '4.81.1',
        date: '2026-11-09',
        title: '协同/Agent/更新检查与设置体验收口',
        sections: [
            {
                type: 'improved',
                label: '✨ 优化',
                items: [
                    '协同写作顶栏移除「剧情」「实时质量」重复入口；实时质量链路下线，质量能力由 MonitorPanelB/质量仪表盘保留',
                    'Agent 会话按当前真实项目恢复，不再回放已删除项目的欢迎语；输入区加宽并支持图片选择/粘贴/拖拽与路径引用',
                    '检查更新补 User-Agent/超时/限流诊断/atom 备用源，失败不再覆盖上次成功结果',
                    'API 测试连通性上移、模型列表限高、高级块折叠；设置页签分常用/高级并记忆展开',
                ],
            },
        ],
    },
    {
        version: '4.81.0',
        date: '2026-11-09',
        title: '社区目录审核阻断项清零',
        sections: [
            {
                type: 'fixed',
                label: '🛡️ 修复',
                items: [
                    'API 越界：revealLeaf（1.7.2）15 处改走 revealLeafCompat；1.6+ 多窗口 API 补守卫；minAppVersion 提至 1.4.4',
                    'HTML 注入：50 处 innerHTML 赋值迁入 sanitizeHTMLToDom 封装；润色实体标记改 DOM 构建',
                    'Modal 生命周期：两个弹窗改用自管 Component 渲染宿主，不再把 plugin 当组件',
                    '残余静态样式：指纹强度预览改用 .nw-intensity-preview* 类',
                ],
            },
            {
                type: 'improved',
                label: '🔧 优化',
                items: [
                    'ESLint 接入官方审核规则（类型感知）：no-unsupported-api / no-plugin-as-component / no-static-styles-assignment / no-forbidden-elements / no-unsanitized',
                    'check:obsidian-api 补 revealLeaf/ensureSideLeaf/getFileByPath 检测；handbook 新增 API/HTML/Modal 约束',
                ],
            },
        ],
    },
    {
        version: '4.80.0',
        date: '2026-11-09',
        title: '社区目录样式合规重构',
        sections: [
            {
                type: 'improved',
                label: '🎨 优化',
                items: [
                    '动态 <style> 注入 11 处 → 0：全部迁入 styles-src，主题变量改用 setCssProps',
                    '字面量内联样式 558 → 0：进度组件/实体向导/生成弹窗/55 个文件改用语义类与 nw-is-* 状态',
                    'check:obsidian-api 新增 style-element / static-style-assignment 两条棘轮门禁 + 自测',
                ],
            },
        ],
    },



];

/**
 * 获取版本摘要（用于更新提示条）
 * 返回该版本前 2-3 条主要更新内容
 * @param version - 版本
 * @returns 结果数组
 */
export function getVersionSummary(version: string): string[] {
    const entry = BUILTIN_CHANGELOG.find(e => e.version === version);
    if (!entry) return [];
    const items: string[] = [];
    for (const section of entry.sections) {
        for (const item of section.items) {
            if (items.length >= 3) return items;
            items.push(item);
        }
    }
    return items;
}
