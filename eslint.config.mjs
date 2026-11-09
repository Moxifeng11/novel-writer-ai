/**
 * eslint.config.mjs — 可证明生效的 lint 配置
 *
 * 2026-11-04 修复：旧实现展开 `pluginObsidianmd.configs.recommended.rules`，
 * 但该导出是 flat config 数组（没有 `.rules`），导致除两条 off 外规则集为空。
 * 现在显式使用插件提供的 ruleConfigs.recommended（纯 rules 对象），并注册
 * @typescript-eslint 插件，保证 no-unused-vars / no-explicit-any 真正执行。
 *
 * 2026-11-09（4.81.0 社区审核）：与官方审核对齐——
 * - `no-unsupported-api` 需要类型信息，读取 manifest.minAppVersion（现 1.4.4），
 *   越界 API（如 1.7.2 revealLeaf）直接 error；
 * - `no-plugin-as-component` / `no-static-styles-assignment` / `no-forbidden-elements` 提到 error；
 * - 官方审核同时使用 `no-unsanitized/property|method` 与 `@microsoft/sdl/no-inner-html`，
 *   本地也接到同一批规则，避免「本地全绿、审核失败」。两者都是 obsidianmd 插件的
 *   传递依赖，不需要新增包。
 *
 * 存量债务策略：关键规则先以 warn 暴露（CI 日志可见），新 error 规则只启用
 * Obsidian 平台安全相关项；后续按 lint 预算逐步升级，不再整体关闭。
 */
import pluginObsidianmd from 'eslint-plugin-obsidianmd';
import noUnsanitized from 'eslint-plugin-no-unsanitized';
import sdl from '@microsoft/eslint-plugin-sdl';
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
            'tmp/**',
            'dist/**',
            // 工具自身的草稿/计划目录，不属于插件源码，也没有进 tsconfig 的 projectService
            '.zcode/**',
            '.trae/**',
            '.obsidian/**',
        ],
    },
    {
        files: ['**/*.ts'],
        languageOptions: {
            parser: tsParser,
            parserOptions: {
                sourceType: 'module',
                ecmaVersion: 2022,
                projectService: true,
                tsconfigRootDir: import.meta.dirname,
            },
        },
        plugins: {
            obsidianmd: pluginObsidianmd,
            '@typescript-eslint': tseslint.plugin,
            'no-unsanitized': noUnsanitized,
            '@microsoft/sdl': sdl,
        },
        rules: {
            ...obsidianRecommended,
            // 本插件 minAppVersion 1.4.4：声明式设置 API（1.13+）不可用，保留 imperative display()
            'obsidianmd/settings-tab/prefer-setting-definitions': 'off',
            'obsidianmd/settings-tab/no-deprecated-display': 'off',
            // 官方审核 Error 规则：越界 API / 插件当组件 / 静态内联样式 / 禁用元素
            'obsidianmd/no-unsupported-api': 'error',
            'obsidianmd/no-plugin-as-component': 'error',
            'obsidianmd/no-static-styles-assignment': 'error',
            'obsidianmd/no-forbidden-elements': 'error',
            // 官方审核的 HTML 注入规则（no-inner-html 在审核里是 warn，本地同样 warn）
            'no-unsanitized/property': 'error',
            'no-unsanitized/method': 'error',
            '@microsoft/sdl/no-inner-html': 'warn',
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

