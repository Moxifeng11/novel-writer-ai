/**
 * zh-CN.ts — 简体中文文案（i18n 期的「源语言」资源）
 *
 * 约定：
 * - 只用「点分键」读取（`t('settings.group.connect')`），不要在代码里拼字符串键。
 * - 插值占位符统一写 `{name}`；占位符集合必须与 en-US 完全一致（check:i18n 校验）。
 * - 这里只放**界面文案**，不放提示词模板、日志、数据文件内容。
 */

/** 文案树：叶子是字符串，中间节点是子表 */
export type MessageTree = { [key: string]: string | MessageTree };

export const zhCN: MessageTree = {
    common: {
        cancel: '取消',
        confirm: '确定',
        close: '关闭',
        refresh: '刷新',
        loading: '加载中…',
    },
    settings: {
        group: {
            connect: '🔌 连接与模型',
            writing: '✍️ 写作与协同',
            rules: '📜 规则与一致性',
            knowledge: '📚 知识与拆解',
            ui: '🎨 界面与工作台',
            ops: '🗂 项目与运维',
        },
        tab: {
            setup: '🚀 首启与自检',
            api: '🔌 API 配置',
            cowrite: '🖥 协同写作',
            writing: '✍️ 写作配置',
            modes: '🎯 创作模式',
            recognition: '🎭 角色识别',
            suggestions: '💡 建议设置',
            template: '📋 模板管理',
            fingerprint: '🔍 写作指纹库',
            knowledge: '📚 写作知识库',
            deconstruction: '🧬 拆解引擎',
            foreshadow: '🔮 伏笔管理',
            rules: '📜 写作规则',
            appearance: '🎨 外观设置',
            layout: '🧩 工作台布局',
            projects: '🗂 项目库迁移',
            performance: '📈 性能监控',
            agent: '🤖 Agent 对话',
            mcp: '🔌 MCP 服务',
            about: 'ℹ️ 关于',
        },
        shell: {
            title: '📖 设置',
            searchPlaceholder: '搜索设置：如「AI 味」「字数目标」「MCP」…',
            searchEmpty: '没有匹配的设置项',
            showAdvanced: '⚙ 高级设置',
            hideAdvanced: '⚙ 收起高级',
            unknownTab: '未知设置页签：{tabId}',
        },
        appearance: {
            language: {
                name: '界面语言',
                desc: '切换插件界面文案的语言。当前版本先提供中文与英文两套；「跟随 Obsidian」按应用语言自动选择，识别不到时用中文。',
                auto: '跟随 Obsidian 语言',
                zhCN: '简体中文',
                enUS: 'English',
            },
        },
    },
};
