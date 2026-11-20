import { defineConfig, globalIgnores } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";

// 复刻 Obsidian 社区插件审核扫描器的判据（见 eslint-plugin-obsidianmd docs/configuration.md
// §Community plugin scanner configuration）：
//   * 扫描器把绝大多数规则降级为 warn，只有下面 errors 里的安全类/tab 类规则会阻断；
//   * 新提交（newest 层）额外收紧 eslint-comments/* 与若干 API 规则。
// 这里把扫描器会降级成 warn 的 recommended error 规则全部显式设为 warn，
// 于是 `npx eslint --config eslint.scanner.mjs .` 的退出码就等价于审核是否会失败。
const blocking = {
  "no-eval": "error",
  "no-unsanitized/method": "error",
  "no-unsanitized/property": "error",
  "obsidianmd/regex-lookbehind": "error",
  "obsidianmd/no-forbidden-elements": "error",
  "no-new-func": "error",
  "obsidianmd/settings-tab/no-manual-html-headings": "error",
  "obsidianmd/settings-tab/no-problematic-settings-headings": "error",
  "obsidianmd/sample-names": "error",
  "obsidianmd/no-sample-code": "error",
  "obsidianmd/platform": "error",
  "obsidianmd/no-plugin-as-component": "error",
  "obsidianmd/detach-leaves": "error",
  "obsidianmd/no-static-styles-assignment": "error",
  "obsidianmd/no-view-references-in-plugin": "error",
  "obsidianmd/no-unsupported-api": "error",
  "eslint-comments/no-unlimited-disable": "error",
  "eslint-comments/require-description": "error",
  "eslint-comments/disable-enable-pair": "error",
  "eslint-comments/no-restricted-disable": "error",
};

// 扫描器会把下列 recommended error 规则降级为 warn（本地要一致，否则退出码失真）。
const downgraded = [
  "@typescript-eslint/no-unnecessary-type-assertion",
  "@typescript-eslint/no-misused-promises",
  "@typescript-eslint/no-floating-promises",
  "@typescript-eslint/no-redundant-type-constituents",
  "@typescript-eslint/unbound-method",
  "@typescript-eslint/prefer-promise-reject-errors",
  "@typescript-eslint/no-this-alias",
  "@typescript-eslint/await-thenable",
  "@typescript-eslint/no-empty-object-type",
  "@typescript-eslint/no-duplicate-type-constituents",
  "@typescript-eslint/no-require-imports",
  "no-useless-escape",
  "no-empty",
  "no-control-regex",
  "no-misleading-character-class",
  "no-async-promise-executor",
  "no-case-declarations",
  "no-useless-catch",
  "no-irregular-whitespace",
  "no-regex-spaces",
  "no-constant-condition",
  "obsidianmd/rule-custom-message",
];

// 扫描器直接关闭的规则（关掉才与审核判据一致）。
const disabled = {
  "no-undef": "off",
  "@typescript-eslint/no-unsafe-assignment": "off",
  "@typescript-eslint/no-unsafe-member-access": "off",
  "@typescript-eslint/no-unsafe-call": "off",
  "@typescript-eslint/no-unsafe-return": "off",
  "@typescript-eslint/no-unsafe-argument": "off",
  "@typescript-eslint/no-base-to-string": "off",
  "@typescript-eslint/restrict-template-expressions": "off",
  "import/no-unresolved": "off",
};

export default defineConfig([
  { languageOptions: { parserOptions: { projectService: true } } },
  ...obsidianmd.configs.recommended,
  {
    files: ["**/*.{js,cjs,mjs,jsx}"],
    rules: { "no-implied-eval": "error", ...blocking, ...Object.fromEntries(downgraded.map((r) => [r, "warn"])), ...disabled },
  },
  {
    files: ["**/*.{ts,cts,mts,tsx}"],
    rules: {
      "@typescript-eslint/no-implied-eval": "error",
      ...blocking,
      ...Object.fromEntries(downgraded.map((r) => [r, "warn"])), ...disabled,
    },
  },
  globalIgnores([
    "main.js", "workers/", "node_modules/", "dist/", "build/", "pkg/", "test-vault/",
    ".obsidian/", ".trae/", ".zcode/", "docs/", "i18n/", "scripts/", "tests/", "e2e-tests/",
    "**/*.test.*", "**/*.spec.*", "__mocks__/", "**/__mocks__/**",
    "manifest.json", "LICENSE", "*.md", "*.json", "*.yml", "*.yaml",
    "eslint.obsidian.mjs", "eslint.scanner.mjs", "eslint.checkmeta.mjs",
    "esbuild.config.mjs", "version-bump.mjs", "**/*.config.*", "**/*.mjs", "**/*.cjs",
  ]),
]);
