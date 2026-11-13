/**
 * project-standard.ts — 项目标准的单一真相源（TS 门面）
 *
 * **运行时实现**在 `scripts/lib/project-standard-lib.mjs`：
 * 门禁脚本是纯 node，无法 import TS；而 TS 侧也需要同一份数据与规则。
 * 因此按仓库既有模式（`prod-smoke-lib`）——运行时真相放 lib，TS 只做类型化再导出。
 *
 * 这样杜绝了「两套标准定义」的风险：改标准只改 lib 一处。
 */

export {
    PROJECT_STANDARD,
    PROJECT_STANDARD_VERSION,
    FACT_STORE_REL_PATH,
    PROJECT_META_REL_PATH,
    requiredDirPaths,
    namingRuleFor,
    isStandardOutdated,
    chapterNumOfFile,
} from '@/scripts/lib/project-standard-lib.mjs';

export type {
    RequiredDir,
    RequiredFile,
    NamingRule,
    ProjectStandard,
} from '@/scripts/lib/project-standard-lib.mjs';
