/**
 * eslint.config.mjs — 批 T（技术审计）：接入 eslint-plugin-obsidianmd 官方社区规则集
 *
 * 分层策略：
 * - obsidianmd/recommended 全量接入（error 级），守住新增代码质量
 * - 两条规则按本项目实际情况显式关闭（见 rules 覆盖注释）：
 *   - settings-tab/prefer-setting-definitions：声明式设置需 Obsidian 1.13+，
 *     本插件 minAppVersion 1.5.0，采用 imperative display() 属于合理现状
 *   - settings-tab/no-deprecated-display：同上，display() 在 1.13 之前为唯一官方方式
 * - 存量技术债（如内联样式迁移）已在审计报告 C-b/C-c 批次登记，不通过降级规则掩盖
 */
import pluginObsidianmd from 'eslint-plugin-obsidianmd';
import tsParser from '@typescript-eslint/parser';

export default [
    {
        ignores: [
            'node_modules/**',
            'main.js',
            'styles.css',
            'scripts/**',
            'tests/**',
            'coverage/**',
        ],
    },
    {
        files: ['**/*.ts'],
        languageOptions: {
            parser: tsParser,
            parserOptions: {
                sourceType: 'module',
                ecmaVersion: 2022,
            },
        },
        plugins: {
            obsidianmd: pluginObsidianmd,
        },
        rules: {
            ...pluginObsidianmd.configs.recommended.rules,
            // 本插件 minAppVersion 1.5.0：声明式设置 API（1.13+）不可用，保留 imperative display()
            'settings-tab/prefer-setting-definitions': 'off',
            'settings-tab/no-deprecated-display': 'off',
        },
    },
];
