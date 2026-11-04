/**
 * eslint.config.mjs — 可证明生效的 lint 配置
 *
 * 2026-11-04 修复：旧实现展开 `pluginObsidianmd.configs.recommended.rules`，
 * 但该导出是 flat config 数组（没有 `.rules`），导致除两条 off 外规则集为空。
 * 现在显式使用插件提供的 ruleConfigs.recommended（纯 rules 对象），并注册
 * @typescript-eslint 插件，保证 no-unused-vars / no-explicit-any 真正执行。
 *
 * 存量债务策略：关键规则先以 warn 暴露（CI 日志可见），新 error 规则只启用
 * Obsidian 平台安全相关项；后续按 lint 预算逐步升级，不再整体关闭。
 */
import pluginObsidianmd from 'eslint-plugin-obsidianmd';
import tsParser from '@typescript-eslint/parser';
import tseslint from 'typescript-eslint';

const obsidianRecommended = Object.fromEntries(
    Object.entries(pluginObsidianmd.ruleConfigs?.recommended || {})
        .filter(([rule]) => rule.startsWith('obsidianmd/'))
);

export default [
    {
        ignores: [
            'node_modules/**',
            'main.js',
            'styles.css',
            'scripts/**',
            'tests/**',
            'coverage/**',
            'docs/**',
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
            '@typescript-eslint': tseslint.plugin,
        },
        rules: {
            ...obsidianRecommended,
            // 本插件 minAppVersion 1.4.0：声明式设置 API（1.13+）不可用，保留 imperative display()
            'obsidianmd/settings-tab/prefer-setting-definitions': 'off',
            'obsidianmd/settings-tab/no-deprecated-display': 'off',
            // 存量 UI 债务：591 处内联样式 + 11 处动态 <style> 注入。
            // 先 warn 暴露，禁止新增；后续按 CSS 预算迁移，不整体关闭。
            'obsidianmd/no-static-styles-assignment': 'warn',
            'obsidianmd/no-forbidden-elements': 'warn',
            // 存量债务：先暴露不阻断；后续用 lint 预算逐步升级。
            '@typescript-eslint/no-unused-vars': ['warn', {
                args: 'after-used',
                argsIgnorePattern: '^_',
                varsIgnorePattern: '^_',
                ignoreRestSiblings: true,
            }],
            '@typescript-eslint/no-explicit-any': 'warn',
        },
    },
];
