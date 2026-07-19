"use strict";

// services/worker-runtime.ts
var taskHandlers = /* @__PURE__ */ new Map();
var abortControllers = /* @__PURE__ */ new Map();
function postMessageToMain(type, taskId, payload, error) {
  const message = { type, taskId, payload, error };
  self.postMessage(message);
}
function sendProgress(taskId, progress, message) {
  const payload = { progress, message };
  postMessageToMain("task:progress", taskId, payload);
}
function sendComplete(taskId, result) {
  const payload = { result };
  postMessageToMain("task:complete", taskId, payload);
}
function sendTaskError(taskId, error) {
  postMessageToMain("task:error", taskId, void 0, error.message);
}
async function handleTaskStart(payload) {
  const { taskId, taskType, input } = payload;
  const handler = taskHandlers.get(taskType);
  if (!handler) {
    sendTaskError(taskId, new Error(`Unknown task type: ${taskType}`));
    return;
  }
  const abortController = new AbortController();
  abortControllers.set(taskId, abortController);
  try {
    const result = await handler(input, {
      onProgress: (progress, message) => {
        sendProgress(taskId, progress, message);
      },
      signal: abortController.signal
    });
    sendComplete(taskId, result);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return;
    }
    sendTaskError(taskId, error instanceof Error ? error : new Error(String(error)));
  } finally {
    abortControllers.delete(taskId);
  }
}
function handleTaskCancel(taskId) {
  const abortController = abortControllers.get(taskId);
  if (abortController) {
    abortController.abort();
    abortControllers.delete(taskId);
  }
}
function handleMessage(event) {
  const { type, taskId, payload } = event.data;
  switch (type) {
    case "task:start":
      handleTaskStart(payload);
      break;
    case "task:cancel":
      if (taskId) {
        handleTaskCancel(taskId);
      }
      break;
    default:
      break;
  }
}
function registerTaskHandler(taskType, handler) {
  taskHandlers.set(taskType, handler);
}
function startWorkerRuntime() {
  self.onmessage = handleMessage;
  postMessageToMain("worker:ready");
}

// shared/paths.ts
var SUBDIR_WORLD_ARCH = "01-\u4E16\u754C\u67B6\u6784";
var SUBDIR_CHARS = `${SUBDIR_WORLD_ARCH}/\u4EBA\u7269`;
var SUBDIR_LOCS = `${SUBDIR_WORLD_ARCH}/\u5730\u70B9`;
var SUBDIR_FACTIONS = `${SUBDIR_WORLD_ARCH}/\u52BF\u529B`;
var SUBDIR_ITEMS = `${SUBDIR_WORLD_ARCH}/\u7269\u54C1\u529F\u6CD5`;
var SUBDIR_WORLDVIEW_FILE = `${SUBDIR_WORLD_ARCH}/\u4E16\u754C\u89C2\u603B\u89C8.md`;
var SUBDIR_SETTING_LIB_FILE = `${SUBDIR_WORLD_ARCH}/\u8BBE\u5B9A\u5E93.md`;
var SUBDIR_WRITING_STYLE_FILE = `${SUBDIR_WORLD_ARCH}/\u6587\u7B14\u98CE\u683C.md`;
var PJ_TEMPLATE_DIR = "\u5143\u6587\u4EF6/00-\u7CFB\u7EDF\u6A21\u677F";
var PJ_PROMPT_TEMPLATE_DIR = `${PJ_TEMPLATE_DIR}/prompts`;
var WRITING_RULES_PATH_TEMPLATE = `${PJ_TEMPLATE_DIR}/\u5199\u4F5C\u89C4\u5219.md`;
var DEFAULT_KNOWLEDGE_BASE_DIR = "\u5199\u4F5C\u77E5\u8BC6\u5E93";
var KB_STYLE_FINGERPRINT_FILE = "\u98CE\u683C\u6307\u7EB9.json";
function kbKnowledgeBaseDir(baseDir) {
  return baseDir || DEFAULT_KNOWLEDGE_BASE_DIR;
}
function kbBookDir(bookName, baseDir) {
  const safeBookName = bookName.replace(/[\\/:*?"<>|]/g, "_");
  return `${kbKnowledgeBaseDir(baseDir)}/${safeBookName}`;
}
function kbBookStyleFingerprintFile(bookName, baseDir) {
  return `${kbBookDir(bookName, baseDir)}/${KB_STYLE_FINGERPRINT_FILE}`;
}

// shared/yield.ts
function yieldToUI() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// engine/dimension-keywords.ts
var FIVE_SENSES_WORDS = {
  visual: [
    "\u770B",
    "\u671B",
    "\u89C6",
    "\u7779",
    "\u7785",
    "\u779F",
    "\u77A5",
    "\u77AA",
    "\u6CE8\u89C6",
    "\u51DD\u89C6",
    "\u7AEF\u8BE6",
    "\u6253\u91CF",
    "\u5BA1\u89C6",
    "\u89C2\u5BDF",
    "\u89C2\u770B",
    "\u67E5\u770B",
    "\u5BDF\u770B",
    "\u89C2\u671B",
    "\u77AD\u671B",
    "\u773A\u671B",
    "\u4EF0\u671B",
    "\u4FEF\u89C6",
    "\u4FEF\u77B0",
    "\u5E73\u89C6",
    "\u659C\u89C6",
    "\u6B63\u89C6",
    "\u4FA7\u89C6",
    "\u73AF\u89C6",
    "\u626B\u89C6",
    "\u5DE1\u89C6",
    "\u76EE\u51FB",
    "\u76EE\u7779",
    "\u7AA5\u89C1",
    "\u77A5\u89C1",
    "\u770B\u89C1",
    "\u770B\u5230",
    "\u671B\u89C1",
    "\u89C6\u82E5\u65E0\u7779",
    "\u89C6\u800C\u4E0D\u89C1",
    "\u719F\u89C6\u65E0\u7779",
    "\u76EE\u4E0D\u8F6C\u775B",
    "\u5168\u795E\u8D2F\u6CE8",
    "\u805A\u7CBE\u4F1A\u795E",
    "\u4E13\u5FC3\u81F4\u5FD7",
    "\u4E00\u5FC3\u4E00\u610F",
    "\u76EE\u4E0D\u659C\u89C6",
    "\u76EE\u4E0D\u7AA5\u56ED",
    "\u5168\u795E\u704C\u6CE8",
    "\u4E13\u5FC3\u4E00\u5FD7",
    "\u4E00\u76EE\u4E86\u7136",
    "\u5386\u5386\u5728\u76EE",
    "\u6E05\u6E05\u695A\u695A",
    "\u660E\u660E\u767D\u767D",
    "\u771F\u771F\u5207\u5207",
    "\u6A21\u7CCA",
    "\u6726\u80E7",
    "\u9690\u7EA6",
    "\u4F9D\u7A00",
    "\u604D\u60DA",
    "\u8FF7\u832B",
    "\u8FF7\u8499",
    "\u7F25\u7F08",
    "\u865A\u65E0",
    "\u865A\u5E7B",
    "\u6E05\u6670",
    "\u6E05\u695A",
    "\u771F\u5207",
    "\u660E\u786E",
    "\u660E\u663E",
    "\u663E\u8457",
    "\u9192\u76EE",
    "\u8000\u773C",
    "\u593A\u76EE",
    "\u7F8E\u4E3D",
    "\u6F02\u4EAE",
    "\u597D\u770B",
    "\u7F8E\u89C2",
    "\u7CBE\u81F4",
    "\u7CBE\u7F8E",
    "\u79C0\u4E3D",
    "\u79C0\u7F8E",
    "\u4FCA\u7F8E",
    "\u4FCF\u4E3D",
    "\u4E11\u964B",
    "\u96BE\u770B",
    "\u4E11\u6076",
    "\u8C8C\u4E11",
    "\u5176\u8C8C\u4E0D\u626C",
    "\u4E11\u516B\u602A",
    "\u4E11\u6001\u767E\u51FA",
    "\u4E11\u6001\u6BD5\u9732",
    "\u4E22\u4EBA\u73B0\u773C",
    "\u4E0D\u582A\u5165\u76EE"
  ],
  auditory: [
    "\u542C",
    "\u95FB",
    "\u8046",
    "\u54CD",
    "\u58F0",
    "\u97F3",
    "\u9E23",
    "\u53EB",
    "\u558A",
    "\u547C",
    "\u5578",
    "\u557C",
    "\u568E",
    "\u543C",
    "\u547B",
    "\u541F",
    "\u53F9",
    "\u606F",
    "\u545C\u54BD",
    "\u54FD\u54BD",
    "\u8046\u542C",
    "\u503E\u542C",
    "\u9759\u542C",
    "\u5077\u542C",
    "\u7A83\u542C",
    "\u6253\u542C",
    "\u542C\u95FB",
    "\u8033\u95FB",
    "\u542C\u8BF4",
    "\u95FB\u8BAF",
    "\u58F0\u97F3",
    "\u58F0\u54CD",
    "\u54CD\u58F0",
    "\u97F3\u54CD",
    "\u58F0\u606F",
    "\u58F0\u6D6A",
    "\u58F0\u6CE2",
    "\u58F0\u8272",
    "\u58F0\u52BF",
    "\u58F0\u5A01",
    "\u53EB\u58F0",
    "\u558A\u58F0",
    "\u547C\u58F0",
    "\u543C\u58F0",
    "\u568E\u58F0",
    "\u557C\u58F0",
    "\u9E23\u58F0",
    "\u5578\u58F0",
    "\u541F\u58F0",
    "\u53F9\u58F0",
    "\u6B4C\u58F0",
    "\u4E50\u58F0",
    "\u7434\u58F0",
    "\u7B1B\u58F0",
    "\u7BAB\u58F0",
    "\u9F13\u58F0",
    "\u9523\u58F0",
    "\u949F\u58F0",
    "\u78EC\u58F0",
    "\u94C3\u58F0",
    "\u5608\u6742",
    "\u55A7\u95F9",
    "\u55A7\u56A3",
    "\u5435\u95F9",
    "\u55A7\u54D7",
    "\u55A7\u56B7",
    "\u55A7\u9617",
    "\u8052\u566A",
    "\u5608\u5435",
    "\u95F9\u54C4\u54C4",
    "\u5B89\u9759",
    "\u5BC2\u9759",
    "\u5B81\u9759",
    "\u5E73\u9759",
    "\u6C89\u9759",
    "\u5E7D\u9759",
    "\u6E05\u5E7D",
    "\u9759\u8C27",
    "\u5BC2\u7136",
    "\u6084\u7136",
    "\u9E26\u96C0\u65E0\u58F0",
    "\u4E07\u7C41\u4FF1\u5BC2",
    "\u591C\u6DF1\u4EBA\u9759",
    "\u66F4\u6DF1\u591C\u9759",
    "\u6084\u7136\u65E0\u58F0",
    "\u6084\u65E0\u58F0\u606F",
    "\u65E0\u58F0\u65E0\u606F",
    "\u4E0D\u58F0\u4E0D\u54CD",
    "\u4E00\u58F0\u4E0D\u542D",
    "\u4E00\u8A00\u4E0D\u53D1",
    "\u9707\u8033\u6B32\u804B",
    "\u60CA\u5929\u52A8\u5730",
    "\u9707\u5929\u52A8\u5730",
    "\u54CD\u5F7B\u4E91\u9704",
    "\u54CD\u904F\u884C\u4E91",
    "\u5982\u96F7\u8D2F\u8033",
    "\u632F\u804B\u53D1\u8069",
    "\u77F3\u7834\u5929\u60CA",
    "\u7A7F\u4E91\u88C2\u77F3",
    "\u88C2\u77F3\u7A7F\u4E91"
  ],
  olfactory: [
    "\u95FB",
    "\u55C5",
    "\u9999",
    "\u81ED",
    "\u8165",
    "\u81CA",
    "\u82B3",
    "\u82AC",
    "\u99A8",
    "\u523A\u9F3B",
    "\u6D53\u90C1",
    "\u5E7D\u9999",
    "\u6E05\u9999",
    "\u6697\u9999",
    "\u82B3\u9999",
    "\u99A8\u9999",
    "\u82AC\u82B3",
    "\u82B3\u83F2",
    "\u9999\u9187",
    "\u9999\u751C",
    "\u81ED\u5473",
    "\u81ED\u6C14",
    "\u6076\u81ED",
    "\u8150\u81ED",
    "\u998A\u81ED",
    "\u9178\u81ED",
    "\u6C57\u81ED",
    "\u811A\u81ED",
    "\u53E3\u81ED",
    "\u72D0\u81ED",
    "\u8165\u5473",
    "\u8165\u6C14",
    "\u8840\u8165",
    "\u8165\u81ED",
    "\u8165\u81BB",
    "\u8165\u81CA",
    "\u6D77\u8165",
    "\u9C7C\u8165\u5473",
    "\u8089\u8165\u5473",
    "\u8840\u8165\u5473",
    "\u81CA\u5473",
    "\u81CA\u6C14",
    "\u81BB\u5473",
    "\u81BB\u6C14",
    "\u8165\u81BB",
    "\u81CA\u81BB",
    "\u81BB\u8165",
    "\u81CA\u8165",
    "\u81BB\u81CA",
    "\u9999\u5473",
    "\u9999\u6C14",
    "\u6D53\u9999",
    "\u6DE1\u9999",
    "\u6D45\u9999",
    "\u82B1\u9999",
    "\u679C\u9999",
    "\u6728\u9999",
    "\u8349\u9999",
    "\u8336\u9999",
    "\u9152\u9999",
    "\u996D\u9999",
    "\u83DC\u9999",
    "\u8089\u9999",
    "\u9AA8\u9999",
    "\u523A\u9F3B\u7684",
    "\u545B\u4EBA",
    "\u545B\u9F3B",
    "\u8FA3\u9F3B\u5B50",
    "\u51B2\u9F3B\u5B50",
    "\u718F\u4EBA",
    "\u718F\u9F3B\u5B50",
    "\u96BE\u95FB",
    "\u597D\u95FB",
    "\u6C81\u4EBA\u5FC3\u813E",
    "\u9999\u6C14\u6251\u9F3B",
    "\u82B3\u9999\u56DB\u6EA2",
    "\u9999\u6C14\u88AD\u4EBA",
    "\u82AC\u82B3\u99A5\u90C1",
    "\u99A8\u9999\u7977\u795D",
    "\u6842\u99A5\u5170\u9999",
    "\u56FD\u8272\u5929\u9999",
    "\u9E1F\u8BED\u82B1\u9999",
    "\u53E4\u8272\u53E4\u9999",
    "\u81ED\u4E0D\u53EF\u95FB",
    "\u81ED\u4E0D\u53EF\u5F53",
    "\u81ED\u6C14\u718F\u5929",
    "\u81ED\u540D\u8FDC\u626C",
    "\u81ED\u540D\u662D\u8457",
    "\u81ED\u5473\u76F8\u6295",
    "\u5982\u8747\u9010\u81ED",
    "\u5982\u8681\u9644\u81BB",
    "\u8165\u98CE\u8840\u96E8",
    "\u4E4C\u70DF\u7634\u6C14"
  ],
  gustatory: [
    "\u5C1D",
    "\u751C",
    "\u9178",
    "\u82E6",
    "\u8FA3",
    "\u54B8",
    "\u9C9C",
    "\u6DA9",
    "\u6DE1",
    "\u6D53",
    "\u7F8E\u5473",
    "\u7518\u751C",
    "\u53EF\u53E3",
    "\u597D\u5403",
    "\u9C9C\u7F8E",
    "\u9999\u751C",
    "\u723D\u53E3",
    "\u6E05\u8106",
    "\u9165\u8F6F",
    "\u7EF5\u8F6F",
    "\u751C\u5473",
    "\u7518\u5473",
    "\u751C\u5473\u513F",
    "\u7518\u751C\u5473",
    "\u871C\u751C",
    "\u751C\u7F8E",
    "\u751C\u871C",
    "\u751C\u6DA6",
    "\u9178\u5473",
    "\u9178\u5473\u513F",
    "\u9178\u6DA9",
    "\u9178\u82E6",
    "\u9178\u751C",
    "\u9178\u8FA3",
    "\u9178\u54B8",
    "\u9178\u9999",
    "\u9178\u81ED",
    "\u9178\u998A",
    "\u82E6\u5473",
    "\u82E6\u5473\u513F",
    "\u82E6\u6DA9",
    "\u82E6\u54B8",
    "\u82E6\u8FA3",
    "\u82E6\u9178",
    "\u82E6\u751C",
    "\u82E6\u9999",
    "\u82E6\u81ED",
    "\u82E6\u836F",
    "\u8FA3\u5473",
    "\u8FA3\u5473\u513F",
    "\u8F9B\u8FA3",
    "\u9EBB\u8FA3",
    "\u9178\u8FA3",
    "\u751C\u8FA3",
    "\u54B8\u8FA3",
    "\u9999\u8FA3",
    "\u6BD2\u8FA3",
    "\u54B8\u5473",
    "\u54B8\u5473\u513F",
    "\u54B8\u6DA9",
    "\u54B8\u82E6",
    "\u54B8\u9178",
    "\u54B8\u751C",
    "\u54B8\u9999",
    "\u54B8\u81ED",
    "\u54B8\u8165",
    "\u9C9C\u5473",
    "\u9C9C\u5473\u513F",
    "\u9C9C\u751C",
    "\u9C9C\u54B8",
    "\u9C9C\u8FA3",
    "\u9C9C\u9999",
    "\u9C9C\u5AE9",
    "\u9C9C\u6D3B",
    "\u65B0\u9C9C",
    "\u6DA9\u5473",
    "\u6DA9\u5473\u513F",
    "\u5E72\u6DA9",
    "\u751F\u6DA9",
    "\u8270\u6DA9",
    "\u6666\u6DA9",
    "\u6DA9\u53E3",
    "\u6DA9\u6EDE",
    "\u56DE\u5473\u65E0\u7A77",
    "\u6D25\u6D25\u6709\u5473",
    "\u7D22\u7136\u65E0\u5473",
    "\u5473\u540C\u56BC\u8721",
    "\u4E94\u5473\u6742\u9648",
    "\u9178\u751C\u82E6\u8FA3",
    "\u54B8\u751C\u82E6\u8FA3",
    "\u5C71\u73CD\u6D77\u5473",
    "\u7F8E\u5473\u4F73\u80B4",
    "\u5BB6\u5E38\u4FBF\u996D"
  ],
  tactile: [
    "\u6478",
    "\u89E6",
    "\u78B0",
    "\u8F6F",
    "\u786C",
    "\u51B7",
    "\u70ED",
    "\u51C9",
    "\u6696",
    "\u6ED1",
    "\u7CD9",
    "\u75DB",
    "\u75D2",
    "\u9EBB",
    "\u9178",
    "\u80C0",
    "\u6C89",
    "\u91CD",
    "\u8F7B",
    "\u6D6E",
    "\u89E6\u6478",
    "\u629A\u6478",
    "\u8F7B\u629A",
    "\u8F7B\u89E6",
    "\u89E6\u78B0",
    "\u78B0\u89E6",
    "\u89E6\u53CA",
    "\u89E6\u78B0\u5230",
    "\u89E6\u6478\u5230",
    "\u629A\u6478\u7740",
    "\u67D4\u8F6F",
    "\u7EF5\u8F6F",
    "\u67D4\u97E7",
    "\u8F6F\u4E4E\u4E4E",
    "\u8F6F\u7EF5\u7EF5",
    "\u8F6F\u584C\u584C",
    "\u67D4\u8F6F\u5982\u68C9",
    "\u67D4\u82E5\u65E0\u9AA8",
    "\u575A\u786C",
    "\u521A\u786C",
    "\u786C\u6717",
    "\u786C\u90A6\u90A6",
    "\u786C\u633A\u633A",
    "\u786C\u94EE\u94EE",
    "\u575A\u5982\u78D0\u77F3",
    "\u575A\u4E0D\u53EF\u6467",
    "\u56FA\u82E5\u91D1\u6C64",
    "\u7262\u4E0D\u53EF\u7834",
    "\u51B0\u51B7",
    "\u51B0\u51C9",
    "\u5BD2\u51B7",
    "\u4E25\u5BD2",
    "\u9177\u5BD2",
    "\u523A\u9AA8",
    "\u51B0\u5BD2",
    "\u51BB\u50F5",
    "\u51BB\u4F24",
    "\u51B0\u51B7\u523A\u9AA8",
    "\u708E\u70ED",
    "\u70BD\u70ED",
    "\u9177\u70ED",
    "\u7099\u70ED",
    "\u707C\u70ED",
    "\u6EDA\u70EB",
    "\u706B\u8FA3",
    "\u71E5\u70ED",
    "\u95F7\u70ED",
    "\u708E\u70ED\u96BE\u8010",
    "\u51C9\u723D",
    "\u6E05\u51C9",
    "\u6E05\u723D",
    "\u51C9\u5FEB",
    "\u51C9\u610F",
    "\u6E05\u51B7",
    "\u9634\u51C9",
    "\u9634\u51C9\u5904",
    "\u6E05\u98CE\u5F90\u6765",
    "\u51C9\u98CE\u4E60\u4E60",
    "\u6E29\u6696",
    "\u6696\u548C",
    "\u6E29\u70ED",
    "\u6696\u6D0B\u6D0B",
    "\u6696\u70D8\u70D8",
    "\u6696\u878D\u878D",
    "\u6696\u610F\u878D\u878D",
    "\u6E29\u6696\u5982\u6625",
    "\u5982\u6C90\u6625\u98CE",
    "\u6696\u610F\u6D0B\u6D0B",
    "\u5149\u6ED1",
    "\u5E73\u6ED1",
    "\u5149\u6DA6",
    "\u6ED1\u6E9C",
    "\u6ED1\u817B",
    "\u7EC6\u5AE9",
    "\u7EC6\u817B",
    "\u7EC6\u81F4",
    "\u7EC6\u5BC6",
    "\u7CBE\u81F4"
  ]
};

// engine/genre/genre-presets/cultivation.genre.json
var cultivation_genre_default = {
  genreId: "cultivation",
  displayName: "\u4FEE\u4ED9",
  behaviorTraits: [
    { word: "\u6E21\u52AB", trait: "\u575A\u97E7" },
    { word: "\u987F\u609F", trait: "\u609F\u6027" },
    { word: "\u95ED\u5173", trait: "\u4E13\u6CE8" },
    { word: "\u4FEE\u70BC", trait: "\u575A\u6BC5" },
    { word: "\u7A81\u7834", trait: "\u8FDB\u53D6" }
  ],
  abilityKeywords: ["\u529F\u6CD5", "\u6B66\u6280", "\u5883\u754C", "\u4FEE\u4E3A", "\u6CD5\u672F", "\u795E\u901A", "\u7EDD\u6280", "\u79D8\u6CD5"],
  techniqueKeywords: ["\u5347\u7EA7", "\u6253\u8138", "\u626E\u732A\u5403\u864E", "\u9006\u88AD"],
  foreshadowTypes: ["\u529F\u6CD5", "\u79D8\u5B9D", "\u4F20\u627F", "\u5929\u52AB", "\u5F02\u5B9D"],
  conflictKeywords: ["\u6597\u6CD5", "\u6E21\u52AB", "\u53AE\u6740", "\u56F4\u653B"],
  showSignalWords: ["\u770B", "\u542C", "\u95FB", "\u9053", "\u8BF4", "\u7B11", "\u6012", "\u559D"],
  styleKeywords: ["\u4ED9\u4FA0", "\u7384\u5E7B", "\u98D8\u9038", "\u82CD\u832B"],
  detectorSignals: ["\u529F\u6CD5", "\u4FEE\u4E3A", "\u5883\u754C", "\u6E21\u52AB", "\u7075\u6839", "\u4FEE\u771F", "\u70BC\u6C14", "\u7B51\u57FA", "\u91D1\u4E39", "\u5143\u5A74", "\u5316\u795E"],
  tensionKeywords: {
    conflict: ["\u6597\u6CD5", "\u53AE\u6740", "\u56F4\u653B", "\u5BF9\u51B3", "\u4EA4\u624B", "\u6FC0\u6218", "\u5927\u6218", "\u9635\u6CD5\u5BF9\u51B3"],
    suspense: ["\u7A76\u7ADF", "\u96BE\u9053", "\u7ADF\u7136", "\u672A\u66FE\u60F3", "\u6B8A\u4E0D\u77E5", "\u8BE1\u5F02", "\u53EF\u7591"],
    reversal: ["\u53CD\u8F6C", "\u9006\u8F6C", "\u7A81\u7136", "\u7136\u800C", "\u4E0D\u6599", "\u51FA\u4E4E\u610F\u6599", "\u59CB\u6599\u672A\u53CA"],
    cool_point: ["\u7A81\u7834", "\u5347\u7EA7", "\u987F\u609F", "\u4FEE\u4E3A\u5927\u8FDB", "\u626E\u732A\u5403\u864E", "\u6253\u8138", "\u53CD\u6740", "\u78BE\u538B", "\u79D2\u6740", "\u5927\u80DC"],
    setback: ["\u91CD\u4F24", "\u9668\u843D", "\u8D70\u706B\u5165\u9B54", "\u60E8\u8D25", "\u6E83\u8D25", "\u53D7\u632B", "\u4E07\u5FF5\u4FF1\u7070"],
    climax: ["\u6E21\u52AB", "\u51B3\u6218", "\u7EC8\u6781\u4E00\u6218", "\u751F\u6B7B\u5173\u5934", "\u5DC5\u5CF0\u5BF9\u51B3", "\u5BBF\u547D\u5BF9\u51B3", "\u7834\u91DC\u6C89\u821F"]
  },
  waveRhythmKeywords: {
    smallCool: ["\u7A81\u7834", "\u5347\u7EA7", "\u987F\u609F", "\u83B7\u5F97\u529F\u6CD5", "\u6253\u8138"],
    mediumReversal: ["\u53CD\u8F6C", "\u9006\u8F6C", "\u626E\u732A\u5403\u864E", "\u53CD\u6740", "\u51FA\u4E4E\u610F\u6599"],
    bigClimax: ["\u6E21\u52AB", "\u51B3\u6218", "\u7EC8\u6781\u4E00\u6218", "\u5BBF\u547D\u5BF9\u51B3", "\u751F\u6B7B\u5B58\u4EA1"]
  }
};

// engine/genre/genre-presets/military.genre.json
var military_genre_default = {
  genreId: "military",
  displayName: "\u519B\u4E8B",
  behaviorTraits: [
    { word: "\u5927\u7B11", trait: "\u5E7D\u9ED8" },
    { word: "\u8C03\u4F83", trait: "\u6D12\u8131" },
    { word: "\u51B7\u7B11", trait: "\u51B7\u9177" },
    { word: "\u9634\u6C89", trait: "\u51B7\u9177" },
    { word: "\u6C89\u601D", trait: "\u667A\u8C0B" },
    { word: "\u5206\u6790", trait: "\u667A\u8C0B" },
    { word: "\u51B2\u950B", trait: "\u52C7\u6562" },
    { word: "\u65AD\u540E", trait: "\u52C7\u6562" },
    { word: "\u65E0\u754F", trait: "\u65E0\u754F" }
  ],
  abilityKeywords: ["\u7EDF\u5E05", "\u8C0B\u7565", "\u8BA1\u7B56", "\u6218\u7565", "\u6218\u672F", "\u9886\u5BFC", "\u86CA\u60D1", "\u8BF4\u670D", "\u6D1E\u5BDF", "\u6307\u6325"],
  techniqueKeywords: ["\u519B\u4E8B\u8C0B\u7565", "\u653F\u6CBB\u535A\u5F08", "\u8BBD\u523A\u5E7D\u9ED8", "\u70ED\u8840\u71C3\u5411", "\u6218\u4E89\u573A\u9762"],
  foreshadowTypes: ["\u9634\u8C0B", "\u53DB\u4E71", "\u6697\u6740", "\u653F\u6CBB\u53D8\u5C40", "\u5BC6\u8C0B"],
  conflictKeywords: ["\u53AE\u6740", "\u6E83\u9000", "\u56F4\u653B", "\u51B2\u950B", "\u6218\u6597", "\u6218", "\u6740", "\u653B", "\u5B88"],
  showSignalWords: ["\u770B", "\u542C", "\u95FB", "\u9053", "\u8BF4", "\u7B11", "\u6012", "\u559D", "\u51B2", "\u780D"],
  styleKeywords: ["\u70ED\u8840", "\u94C1\u8840", "\u8BBD\u523A", "\u5E7D\u9ED8", "\u519B\u4E8B", "\u6218\u4E89"],
  detectorSignals: ["\u7EDF\u5E05", "\u8C0B\u7565", "\u53AE\u6740", "\u6E83\u9000", "\u519B\u56E2", "\u5E1D\u56FD", "\u6218\u4E89", "\u5C06\u519B", "\u7EDF\u9886", "\u6218\u5F79", "\u6218\u672F", "\u6218\u7565"],
  tensionKeywords: {
    conflict: ["\u53AE\u6740", "\u6E83\u9000", "\u56F4\u653B", "\u51B2\u950B", "\u6218\u6597", "\u6FC0\u6218", "\u4EA4\u950B", "\u5BF9\u9635", "\u653B\u57CE", "\u640F\u6597", "\u5175\u620E\u76F8\u89C1"],
    suspense: ["\u7A76\u7ADF", "\u96BE\u9053", "\u9634\u8C0B", "\u53DB\u4E71", "\u5BC6\u8C0B", "\u8BE1\u5F02", "\u53EF\u7591"],
    reversal: ["\u53CD\u8F6C", "\u9006\u8F6C", "\u7A81\u7136", "\u7136\u800C", "\u4E0D\u6599", "\u51FA\u4E4E\u610F\u6599", "\u59CB\u6599\u672A\u53CA", "\u5CF0\u56DE\u8DEF\u8F6C"],
    cool_point: ["\u5927\u80DC", "\u5B8C\u80DC", "\u53CD\u6740", "\u6253\u8138", "\u78BE\u538B", "\u6A2A\u626B", "\u52BF\u5982\u7834\u7AF9", "\u626C\u7709\u5410\u6C14", "\u5927\u5FEB\u4EBA\u5FC3"],
    setback: ["\u60E8\u8D25", "\u5927\u8D25", "\u6E83\u8D25", "\u5931\u5229", "\u91CD\u4F24", "\u727A\u7272", "\u635F\u5931", "\u5669\u8017", "\u91CD\u521B", "\u6E83\u9000"],
    climax: ["\u51B3\u6218", "\u7EC8\u6781\u4E00\u6218", "\u751F\u6B7B\u5173\u5934", "\u5DC5\u5CF0\u5BF9\u51B3", "\u5BBF\u547D\u5BF9\u51B3", "\u80CC\u6C34\u4E00\u6218", "\u7834\u91DC\u6C89\u821F", "\u5B64\u6CE8\u4E00\u63B7"]
  },
  waveRhythmKeywords: {
    smallCool: ["\u83B7\u80DC", "\u7834\u654C", "\u8C0B\u7565\u5F97\u901E", "\u6253\u8138", "\u626C\u7709\u5410\u6C14"],
    mediumReversal: ["\u53CD\u8F6C", "\u9006\u8F6C", "\u53CD\u6740", "\u51FA\u4E4E\u610F\u6599", "\u5CF0\u56DE\u8DEF\u8F6C"],
    bigClimax: ["\u51B3\u6218", "\u7EC8\u6781\u4E00\u6218", "\u751F\u6B7B\u5B58\u4EA1", "\u5DC5\u5CF0\u5BF9\u51B3", "\u7834\u91DC\u6C89\u821F"]
  }
};

// engine/genre/genre-presets/romance.genre.json
var romance_genre_default = {
  genreId: "romance",
  displayName: "\u8A00\u60C5",
  behaviorTraits: [
    { word: "\u9ED8\u9ED8\u5B88\u62A4", trait: "\u6DF1\u60C5" },
    { word: "\u9690\u5FCD", trait: "\u514B\u5236" },
    { word: "\u542B\u6CEA", trait: "\u67D4\u60C5" },
    { word: "\u5FAE\u7B11", trait: "\u6E29\u67D4" }
  ],
  abilityKeywords: ["\u533B\u672F", "\u53A8\u827A", "\u7434\u827A", "\u7ED8\u753B", "\u523A\u7EE3"],
  techniqueKeywords: ["\u751C\u5BA0", "\u8650\u604B", "\u8BEF\u4F1A", "\u7834\u955C\u91CD\u5706", "\u9082\u9005"],
  foreshadowTypes: ["\u65E7\u60C5", "\u8EAB\u4E16", "\u8BEF\u4F1A", "\u8A93\u8A00"],
  conflictKeywords: ["\u8BEF\u4F1A", "\u5206\u79BB", "\u51B2\u7A81", "\u4E89\u5435", "\u51B7\u6218"],
  showSignalWords: ["\u770B", "\u542C", "\u95FB", "\u7B11", "\u54ED", "\u8BF4", "\u60F3", "\u89C9\u5F97"],
  styleKeywords: ["\u7EC6\u817B", "\u8650\u5FC3", "\u751C\u871C", "\u6E29\u99A8"],
  detectorSignals: ["\u751C\u5BA0", "\u8650\u604B", "\u544A\u767D", "\u9082\u9005", "\u60C5\u4E66", "\u7EA6\u4F1A", "\u5FC3\u52A8", "\u66A7\u6627", "\u559C\u6B22", "\u7231", "\u604B\u4EBA", "\u7537\u53CB", "\u5973\u53CB"],
  tensionKeywords: {
    conflict: ["\u8BEF\u4F1A", "\u5206\u79BB", "\u4E89\u5435", "\u51B7\u6218", "\u51B3\u88C2", "\u5206\u624B", "\u51B2\u7A81", "\u4E89\u6267", "\u5BF9\u5CD9"],
    suspense: ["\u7A76\u7ADF", "\u96BE\u9053", "\u7ADF\u7136", "\u672A\u66FE\u60F3", "\u6B8A\u4E0D\u77E5", "\u7591\u60D1", "\u56F0\u60D1"],
    reversal: ["\u53CD\u8F6C", "\u9006\u8F6C", "\u7A81\u7136", "\u7136\u800C", "\u4E0D\u6599", "\u51FA\u4E4E\u610F\u6599", "\u5CF0\u56DE\u8DEF\u8F6C", "\u67F3\u6697\u82B1\u660E"],
    cool_point: ["\u751C\u5BA0", "\u544A\u767D", "\u5FC3\u52A8", "\u7834\u955C\u91CD\u5706", "\u6DF1\u60C5\u544A\u767D", "\u7EC8\u4E8E\u5728\u4E00\u8D77", "\u751C\u871C"],
    setback: ["\u8650\u604B", "\u5206\u624B", "\u8BEF\u4F1A", "\u5FC3\u788E", "\u75DB\u82E6", "\u7EDD\u671B", "\u5D29\u6E83", "\u5FC3\u5982\u5200\u5272", "\u4E07\u5FF5\u4FF1\u7070"],
    climax: ["\u544A\u767D", "\u7834\u955C\u91CD\u5706", "\u6C42\u5A5A", "\u5A5A\u793C", "\u6DF1\u60C5\u76F8\u62E5", "\u7EC8\u6210\u7737\u5C5E", "\u751F\u6B7B\u76F8\u4F9D"]
  },
  waveRhythmKeywords: {
    smallCool: ["\u751C\u5BA0", "\u5FC3\u52A8", "\u544A\u767D", "\u4EB2\u5BC6", "\u751C\u871C"],
    mediumReversal: ["\u8BEF\u4F1A", "\u548C\u89E3", "\u7834\u955C\u91CD\u5706", "\u53CD\u8F6C", "\u51FA\u4E4E\u610F\u6599"],
    bigClimax: ["\u544A\u767D", "\u6C42\u5A5A", "\u5A5A\u793C", "\u7EC8\u6210\u7737\u5C5E", "\u751F\u6B7B\u76F8\u4F9D"]
  }
};

// engine/genre/genre-presets/mystery.genre.json
var mystery_genre_default = {
  genreId: "mystery",
  displayName: "\u60AC\u7591",
  behaviorTraits: [
    { word: "\u76B1\u7709", trait: "\u673A\u8B66" },
    { word: "\u6C89\u601D", trait: "\u673A\u654F" },
    { word: "\u5206\u6790", trait: "\u7406\u6027" }
  ],
  abilityKeywords: ["\u63A8\u7406", "\u89C2\u5BDF", "\u5206\u6790", "\u7834\u6848", "\u4FA6\u67E5"],
  techniqueKeywords: ["\u8BE1\u8BA1", "\u7EBF\u7D22", "\u53CD\u8F6C", "\u771F\u76F8\u63ED\u9732", "\u60AC\u5FF5"],
  foreshadowTypes: ["\u7EBF\u7D22", "\u5ACC\u7591\u4EBA", "\u771F\u76F8", "\u8BC1\u636E", "\u5BC6\u5BA4"],
  conflictKeywords: ["\u8C0B\u6740", "\u547D\u6848", "\u7ED1\u67B6", "\u5A01\u80C1"],
  showSignalWords: ["\u770B", "\u542C", "\u95FB", "\u53D1\u73B0", "\u6CE8\u610F", "\u89C2\u5BDF", "\u5BDF\u89C9"],
  styleKeywords: ["\u7D27\u5F20", "\u60AC\u7591", "\u70E7\u8111", "\u8BE1\u8C32"],
  detectorSignals: ["\u8BE1\u8BA1", "\u7EBF\u7D22", "\u53CD\u8F6C", "\u5ACC\u7591\u4EBA", "\u771F\u76F8", "\u8BC1\u636E", "\u6848\u4EF6", "\u4FA6\u63A2", "\u5BC6\u5BA4", "\u8C0B\u6740", "\u547D\u6848", "\u7834\u6848"],
  tensionKeywords: {
    conflict: ["\u8C0B\u6740", "\u547D\u6848", "\u7ED1\u67B6", "\u5A01\u80C1", "\u5BF9\u5CD9", "\u8FFD\u6355", "\u51B2\u7A81"],
    suspense: ["\u7EBF\u7D22", "\u8BC1\u636E", "\u771F\u76F8", "\u8C1C\u56E2", "\u7591\u56E2", "\u60AC\u5FF5", "\u7591\u60D1", "\u7A76\u7ADF", "\u5230\u5E95", "\u96BE\u9053", "\u8E4A\u8DF7", "\u53E4\u602A"],
    reversal: ["\u53CD\u8F6C", "\u9006\u8F6C", "\u771F\u76F8\u5927\u767D", "\u6C34\u843D\u77F3\u51FA", "\u7A81\u7136", "\u7136\u800C", "\u4E0D\u6599", "\u51FA\u4E4E\u610F\u6599", "\u59CB\u6599\u672A\u53CA"],
    cool_point: ["\u7834\u6848", "\u771F\u76F8\u63ED\u9732", "\u6C34\u843D\u77F3\u51FA", "\u63ED\u5F00", "\u6D6E\u51FA\u6C34\u9762", "\u771F\u76F8\u5927\u767D", "\u6848\u4EF6\u544A\u7834"],
    setback: ["\u7EBF\u7D22\u4E2D\u65AD", "\u5ACC\u7591\u4EBA\u6B7B\u4EA1", "\u8BC1\u636E\u9500\u6BC1", "\u9677\u5165\u50F5\u5C40", "\u53D7\u632B", "\u632B\u8D25", "\u9677\u5165\u56F0\u5883"],
    climax: ["\u771F\u76F8\u63ED\u9732", "\u6C34\u843D\u77F3\u51FA", "\u6848\u4EF6\u544A\u7834", "\u771F\u51F6\u73B0\u8EAB", "\u7EC8\u6781\u771F\u76F8", "\u6700\u540E\u63ED\u9732"]
  },
  waveRhythmKeywords: {
    smallCool: ["\u7EBF\u7D22\u53D1\u73B0", "\u8BC1\u636E\u51FA\u73B0", "\u63A8\u7406\u6B63\u786E", "\u7834\u6848\u8FDB\u5C55"],
    mediumReversal: ["\u53CD\u8F6C", "\u9006\u8F6C", "\u771F\u76F8\u63ED\u9732", "\u51FA\u4E4E\u610F\u6599", "\u5ACC\u7591\u8F6C\u79FB"],
    bigClimax: ["\u771F\u76F8\u5927\u767D", "\u6C34\u843D\u77F3\u51FA", "\u771F\u51F6\u73B0\u8EAB", "\u6848\u4EF6\u544A\u7834", "\u7EC8\u6781\u771F\u76F8"]
  }
};

// engine/genre/genre-presets/scifi.genre.json
var scifi_genre_default = {
  genreId: "scifi",
  displayName: "\u79D1\u5E7B",
  behaviorTraits: [
    { word: "\u63A2\u7D22", trait: "\u597D\u5947" },
    { word: "\u5B9E\u9A8C", trait: "\u4E25\u8C28" },
    { word: "\u5192\u9669", trait: "\u52C7\u6562" }
  ],
  abilityKeywords: ["\u79D1\u6280", "\u5DE5\u7A0B", "\u7F16\u7A0B", "\u7269\u7406", "\u5316\u5B66", "\u751F\u7269"],
  techniqueKeywords: ["\u79D1\u6280\u8BBE\u5B9A", "\u5F02\u661F\u63A2\u7D22", "\u8D5B\u535A\u670B\u514B", "AI\u89C9\u9192", "\u65F6\u95F4\u65C5\u884C"],
  foreshadowTypes: ["\u79D1\u6280", "\u5916\u661F\u6587\u660E", "AI", "\u65F6\u95F4\u6096\u8BBA"],
  conflictKeywords: ["\u6218\u4E89", "\u5165\u4FB5", "\u6BC1\u706D", "\u51B2\u7A81"],
  showSignalWords: ["\u770B", "\u542C", "\u89C2\u5BDF", "\u626B\u63CF", "\u68C0\u6D4B", "\u5206\u6790"],
  styleKeywords: ["\u786C\u79D1\u5E7B", "\u8F6F\u79D1\u5E7B", "\u672A\u6765", "\u8D5B\u535A"],
  detectorSignals: ["\u79D1\u6280", "\u5F02\u661F", "\u661F\u9645", "\u8D5B\u535A", "AI", "\u673A\u5668\u4EBA", "\u98DE\u8239", "\u661F\u7CFB", "\u672A\u6765", "\u5B87\u5B99", "\u5916\u661F", "\u7EF4\u5EA6"],
  tensionKeywords: {
    conflict: ["\u6218\u4E89", "\u5165\u4FB5", "\u6BC1\u706D", "\u51B2\u7A81", "\u4EA4\u6218", "\u5BF9\u6297", "\u5BF9\u5CD9", "\u8FFD\u51FB", "\u6218\u6597"],
    suspense: ["\u7A76\u7ADF", "\u96BE\u9053", "\u672A\u77E5", "\u795E\u79D8", "\u8BE1\u5F02", "\u53EF\u7591", "\u8C1C\u56E2", "\u672A\u77E5\u6587\u660E"],
    reversal: ["\u53CD\u8F6C", "\u9006\u8F6C", "\u7A81\u7136", "\u7136\u800C", "\u4E0D\u6599", "\u51FA\u4E4E\u610F\u6599", "\u59CB\u6599\u672A\u53CA", "\u5CF0\u56DE\u8DEF\u8F6C"],
    cool_point: ["\u79D1\u6280\u7A81\u7834", "\u53D1\u660E", "\u53D1\u73B0", "\u53CD\u51FB", "\u9006\u8F6C", "\u78BE\u538B", "\u80DC\u5229", "\u5927\u83B7\u5168\u80DC"],
    setback: ["\u5931\u8D25", "\u635F\u5931", "\u6BC1\u706D", "\u5D29\u6E83", "\u53D7\u632B", "\u91CD\u521B", "\u727A\u7272", "\u7EDD\u5883"],
    climax: ["\u661F\u9645\u51B3\u6218", "\u7EC8\u6781\u5BF9\u6297", "\u6587\u660E\u5B58\u4EA1", "\u751F\u6B7B\u5173\u5934", "\u5DC5\u5CF0\u5BF9\u51B3", "\u6700\u7EC8\u6218\u5F79"]
  },
  waveRhythmKeywords: {
    smallCool: ["\u79D1\u6280\u7A81\u7834", "\u53D1\u660E", "\u53D1\u73B0", "\u53CD\u51FB\u8FDB\u5C55"],
    mediumReversal: ["\u53CD\u8F6C", "\u9006\u8F6C", "\u51FA\u4E4E\u610F\u6599", "\u5CF0\u56DE\u8DEF\u8F6C"],
    bigClimax: ["\u661F\u9645\u51B3\u6218", "\u6587\u660E\u5B58\u4EA1", "\u6700\u7EC8\u6218\u5F79", "\u751F\u6B7B\u5B58\u4EA1"]
  }
};

// engine/genre/genre-presets/wuxia.genre.json
var wuxia_genre_default = {
  genreId: "wuxia",
  displayName: "\u6B66\u4FA0",
  behaviorTraits: [
    { word: "\u4ED7\u5251", trait: "\u4FA0\u4E49" },
    { word: "\u8C6A\u996E", trait: "\u6D12\u8131" },
    { word: "\u6012\u76EE", trait: "\u521A\u70C8" }
  ],
  abilityKeywords: ["\u5185\u529F", "\u62DB\u5F0F", "\u5251\u6CD5", "\u638C\u6CD5", "\u8F7B\u529F", "\u62F3\u6CD5"],
  techniqueKeywords: ["\u6C5F\u6E56\u6069\u6028", "\u4FA0\u4E49", "\u6BD4\u6B66", "\u95E8\u6D3E", "\u6C5F\u6E56"],
  foreshadowTypes: ["\u79D8\u7C4D", "\u5B9D\u85CF", "\u8EAB\u4E16", "\u95E8\u6D3E"],
  conflictKeywords: ["\u6BD4\u6B66", "\u51B3\u6597", "\u4EC7\u6740", "\u6C5F\u6E56\u6069\u6028"],
  showSignalWords: ["\u770B", "\u542C", "\u8BF4", "\u7B11", "\u559D", "\u65A9", "\u523A"],
  styleKeywords: ["\u4FA0\u4E49", "\u6C5F\u6E56", "\u8C6A\u6C14", "\u521A\u70C8"],
  detectorSignals: ["\u5185\u529F", "\u62DB\u5F0F", "\u6C5F\u6E56", "\u4FA0\u4E49", "\u5251\u5BA2", "\u638C\u95E8", "\u95E8\u6D3E", "\u6BD4\u6B66", "\u51B3\u6597", "\u4FA0\u5BA2", "\u6B66\u6797"],
  tensionKeywords: {
    conflict: ["\u6BD4\u6B66", "\u51B3\u6597", "\u4EC7\u6740", "\u6C5F\u6E56\u6069\u6028", "\u4EA4\u624B", "\u5BF9\u51B3", "\u6FC0\u6218", "\u5355\u6311", "\u5927\u6218", "\u640F\u6597"],
    suspense: ["\u7A76\u7ADF", "\u96BE\u9053", "\u7ADF\u7136", "\u672A\u66FE\u60F3", "\u6B8A\u4E0D\u77E5", "\u795E\u79D8", "\u8BE1\u5F02", "\u53EF\u7591"],
    reversal: ["\u53CD\u8F6C", "\u9006\u8F6C", "\u7A81\u7136", "\u7136\u800C", "\u4E0D\u6599", "\u51FA\u4E4E\u610F\u6599", "\u59CB\u6599\u672A\u53CA", "\u5CF0\u56DE\u8DEF\u8F6C", "\u67F3\u6697\u82B1\u660E"],
    cool_point: ["\u7EDD\u62DB", "\u53CD\u6740", "\u78BE\u538B", "\u79D2\u6740", "\u6A2A\u626B", "\u626C\u7709\u5410\u6C14", "\u5927\u5FEB\u4EBA\u5FC3", "\u75DB\u5FEB", "\u9738\u6C14", "\u6DF1\u85CF\u4E0D\u9732"],
    setback: ["\u91CD\u4F24", "\u60E8\u8D25", "\u53D7\u632B", "\u727A\u7272", "\u8D70\u706B\u5165\u9B54", "\u5FC3\u788E", "\u4E07\u5FF5\u4FF1\u7070", "\u8D70\u6295\u65E0\u8DEF"],
    climax: ["\u51B3\u6218", "\u7EC8\u6781\u4E00\u6218", "\u751F\u6B7B\u5173\u5934", "\u5DC5\u5CF0\u5BF9\u51B3", "\u5BBF\u547D\u5BF9\u51B3", "\u51B3\u4E00\u6B7B\u6218", "\u7834\u91DC\u6C89\u821F"]
  },
  waveRhythmKeywords: {
    smallCool: ["\u7EDD\u62DB", "\u83B7\u80DC", "\u626C\u7709\u5410\u6C14", "\u6253\u8138", "\u75DB\u5FEB"],
    mediumReversal: ["\u53CD\u8F6C", "\u9006\u8F6C", "\u53CD\u6740", "\u51FA\u4E4E\u610F\u6599", "\u5CF0\u56DE\u8DEF\u8F6C"],
    bigClimax: ["\u51B3\u6218", "\u7EC8\u6781\u4E00\u6218", "\u5DC5\u5CF0\u5BF9\u51B3", "\u5BBF\u547D\u5BF9\u51B3", "\u751F\u6B7B\u5B58\u4EA1"]
  }
};

// engine/genre/genre-presets/history.genre.json
var history_genre_default = {
  genreId: "history",
  displayName: "\u5386\u53F2",
  behaviorTraits: [
    { word: "\u53F9\u606F", trait: "\u6DF1\u6C89" },
    { word: "\u6C89\u601D", trait: "\u777F\u667A" },
    { word: "\u51B3\u65AD", trait: "\u679C\u6562" }
  ],
  abilityKeywords: ["\u653F\u6CBB", "\u519B\u4E8B", "\u6743\u8C0B", "\u6CBB\u4E16", "\u7528\u5175"],
  techniqueKeywords: ["\u6743\u8C0B", "\u671D\u5802", "\u53D8\u6CD5", "\u6218\u4E89", "\u653F\u6CBB\u535A\u5F08"],
  foreshadowTypes: ["\u653F\u53D8", "\u53D8\u6CD5", "\u5BC6\u8BCF", "\u8054\u59FB"],
  conflictKeywords: ["\u653F\u53D8", "\u53DB\u4E71", "\u6218\u4E89", "\u671D\u4E89"],
  showSignalWords: ["\u770B", "\u542C", "\u8BF4", "\u7B11", "\u6012", "\u9053"],
  styleKeywords: ["\u539A\u91CD", "\u6062\u5F18", "\u53F2\u8BD7", "\u5386\u53F2\u611F"],
  detectorSignals: ["\u671D\u4EE3", "\u7687\u6743", "\u653F\u6CBB", "\u53D8\u6CD5", "\u6218\u4E89", "\u7687\u5E1D", "\u671D\u5802", "\u5BB0\u76F8", "\u5C06\u519B", "\u738B\u671D", "\u5E1D\u56FD", "\u6C0F\u65CF"],
  tensionKeywords: {
    conflict: ["\u653F\u53D8", "\u53DB\u4E71", "\u6218\u4E89", "\u671D\u4E89", "\u6743\u8C0B", "\u5BF9\u5CD9", "\u5F81\u6218", "\u53AE\u6740", "\u4EA4\u950B", "\u4E89\u9738"],
    suspense: ["\u7A76\u7ADF", "\u96BE\u9053", "\u9634\u8C0B", "\u5BC6\u8C0B", "\u8BE1\u5F02", "\u53EF\u7591", "\u8C1C\u56E2", "\u7591\u56E2"],
    reversal: ["\u53CD\u8F6C", "\u9006\u8F6C", "\u7A81\u7136", "\u7136\u800C", "\u4E0D\u6599", "\u51FA\u4E4E\u610F\u6599", "\u59CB\u6599\u672A\u53CA", "\u5CF0\u56DE\u8DEF\u8F6C"],
    cool_point: ["\u53D8\u6CD5\u6210\u529F", "\u5F81\u6218\u5927\u6377", "\u6743\u8C0B\u5F97\u901E", "\u4E00\u7EDF\u5929\u4E0B", "\u626C\u7709\u5410\u6C14", "\u5927\u83B7\u5168\u80DC"],
    setback: ["\u6218\u8D25", "\u5931\u5229", "\u653F\u53D8\u5931\u8D25", "\u60E8\u8D25", "\u91CD\u521B", "\u727A\u7272", "\u4F17\u53DB\u4EB2\u79BB"],
    climax: ["\u51B3\u6218", "\u7EC8\u6781\u5BF9\u51B3", "\u4E00\u7EDF\u5929\u4E0B", "\u6539\u671D\u6362\u4EE3", "\u751F\u6B7B\u5B58\u4EA1", "\u5DC5\u5CF0\u5BF9\u51B3", "\u7834\u91DC\u6C89\u821F"]
  },
  waveRhythmKeywords: {
    smallCool: ["\u6743\u8C0B\u5F97\u901E", "\u5F81\u6218\u8FDB\u5C55", "\u626C\u7709\u5410\u6C14", "\u53D8\u6CD5\u63A8\u8FDB"],
    mediumReversal: ["\u53CD\u8F6C", "\u9006\u8F6C", "\u51FA\u4E4E\u610F\u6599", "\u5CF0\u56DE\u8DEF\u8F6C"],
    bigClimax: ["\u51B3\u6218", "\u4E00\u7EDF\u5929\u4E0B", "\u6539\u671D\u6362\u4EE3", "\u751F\u6B7B\u5B58\u4EA1"]
  }
};

// engine/genre/genre-presets/fantasy.genre.json
var fantasy_genre_default = {
  genreId: "fantasy",
  displayName: "\u5947\u5E7B",
  behaviorTraits: [
    { word: "\u5192\u9669", trait: "\u52C7\u6562" },
    { word: "\u63A2\u7D22", trait: "\u597D\u5947" },
    { word: "\u65BD\u6CD5", trait: "\u795E\u79D8" }
  ],
  abilityKeywords: ["\u9B54\u6CD5", "\u5492\u8BED", "\u53EC\u5524", "\u796D\u7940", "\u7B26\u6587"],
  techniqueKeywords: ["\u9B54\u6CD5\u8BBE\u5B9A", "\u5F02\u4E16\u754C", "\u79CD\u65CF", "\u5192\u9669", "\u82F1\u96C4"],
  foreshadowTypes: ["\u9B54\u6CD5", "\u795E\u5668", "\u9884\u8A00", "\u53E4\u8001\u6587\u660E"],
  conflictKeywords: ["\u6218\u4E89", "\u9B54\u6CD5\u5BF9\u6297", "\u5165\u4FB5", "\u8BA8\u4F10"],
  showSignalWords: ["\u770B", "\u542C", "\u95FB", "\u8BF4", "\u65BD\u5C55", "\u5FF5\u8BF5"],
  styleKeywords: ["\u5947\u5E7B", "\u9B54\u6CD5", "\u53F2\u8BD7", "\u5192\u9669"],
  detectorSignals: ["\u9B54\u6CD5", "\u7CBE\u7075", "\u5DE8\u9F99", "\u5492\u8BED", "\u5F02\u4E16\u754C", "\u6CD5\u5E08", "\u5723\u5251", "\u9B54\u738B", "\u796D\u7940", "\u7B26\u6587", "\u5492\u6587", "\u5F02\u754C"],
  tensionKeywords: {
    conflict: ["\u6218\u4E89", "\u9B54\u6CD5\u5BF9\u6297", "\u5165\u4FB5", "\u8BA8\u4F10", "\u5BF9\u51B3", "\u6FC0\u6218", "\u5927\u6218", "\u4EA4\u950B", "\u5BF9\u9635"],
    suspense: ["\u7A76\u7ADF", "\u96BE\u9053", "\u9884\u8A00", "\u795E\u79D8", "\u8BE1\u5F02", "\u53EF\u7591", "\u8C1C\u56E2", "\u672A\u77E5"],
    reversal: ["\u53CD\u8F6C", "\u9006\u8F6C", "\u7A81\u7136", "\u7136\u800C", "\u4E0D\u6599", "\u51FA\u4E4E\u610F\u6599", "\u59CB\u6599\u672A\u53CA", "\u5CF0\u56DE\u8DEF\u8F6C"],
    cool_point: ["\u9B54\u6CD5\u80DC\u5229", "\u6253\u8138", "\u53CD\u6740", "\u78BE\u538B", "\u6A2A\u626B", "\u626C\u7709\u5410\u6C14", "\u5927\u5FEB\u4EBA\u5FC3", "\u6DF1\u85CF\u4E0D\u9732"],
    setback: ["\u6218\u8D25", "\u91CD\u4F24", "\u5931\u8D25", "\u635F\u5931", "\u53D7\u632B", "\u91CD\u521B", "\u727A\u7272", "\u7EDD\u5883"],
    climax: ["\u51B3\u6218", "\u7EC8\u6781\u4E00\u6218", "\u751F\u6B7B\u5173\u5934", "\u5DC5\u5CF0\u5BF9\u51B3", "\u5BBF\u547D\u5BF9\u51B3", "\u7834\u91DC\u6C89\u821F", "\u5B64\u6CE8\u4E00\u63B7"]
  },
  waveRhythmKeywords: {
    smallCool: ["\u9B54\u6CD5\u80DC\u5229", "\u6253\u8138", "\u626C\u7709\u5410\u6C14", "\u8FDB\u5C55"],
    mediumReversal: ["\u53CD\u8F6C", "\u9006\u8F6C", "\u53CD\u6740", "\u51FA\u4E4E\u610F\u6599"],
    bigClimax: ["\u51B3\u6218", "\u7EC8\u6781\u4E00\u6218", "\u5DC5\u5CF0\u5BF9\u51B3", "\u5BBF\u547D\u5BF9\u51B3"]
  }
};

// engine/genre/genre-presets/urban.genre.json
var urban_genre_default = {
  genreId: "urban",
  displayName: "\u90FD\u5E02",
  behaviorTraits: [
    { word: "\u76D8\u7B97", trait: "\u7CBE\u660E" },
    { word: "\u51B3\u65AD", trait: "\u679C\u65AD" },
    { word: "\u5FAE\u7B11", trait: "\u4ECE\u5BB9" }
  ],
  abilityKeywords: ["\u5546\u4E1A", "\u7BA1\u7406", "\u8C08\u5224", "\u6295\u8D44", "\u9ED1\u5BA2"],
  techniqueKeywords: ["\u5546\u6218", "\u804C\u573A", "\u8C6A\u95E8", "\u9006\u88AD", "\u90FD\u5E02"],
  foreshadowTypes: ["\u5546\u6218", "\u8C6A\u95E8", "\u8EAB\u4E16", "\u6295\u8D44"],
  conflictKeywords: ["\u5546\u6218", "\u7ADE\u4E89", "\u80CC\u53DB", "\u8BC9\u8BBC"],
  showSignalWords: ["\u770B", "\u542C", "\u8BF4", "\u7B11", "\u60F3", "\u51B3\u5B9A"],
  styleKeywords: ["\u73B0\u4EE3", "\u90FD\u5E02", "\u5546\u6218", "\u8C6A\u95E8"],
  detectorSignals: ["\u5546\u6218", "\u804C\u573A", "\u90FD\u5E02", "\u8C6A\u95E8", "\u9006\u88AD", "\u516C\u53F8", "CEO", "\u603B\u88C1", "\u6295\u8D44", "\u5546\u4E1A", "\u5408\u540C", "\u80A1\u6743"],
  tensionKeywords: {
    conflict: ["\u5546\u6218", "\u7ADE\u4E89", "\u80CC\u53DB", "\u8BC9\u8BBC", "\u5BF9\u5CD9", "\u51B2\u7A81", "\u4EA4\u950B", "\u5BF9\u6297", "\u4E89\u6597"],
    suspense: ["\u7A76\u7ADF", "\u96BE\u9053", "\u9634\u8C0B", "\u5BC6\u8C0B", "\u8BE1\u5F02", "\u53EF\u7591", "\u8C1C\u56E2", "\u7591\u56E2"],
    reversal: ["\u53CD\u8F6C", "\u9006\u8F6C", "\u7A81\u7136", "\u7136\u800C", "\u4E0D\u6599", "\u51FA\u4E4E\u610F\u6599", "\u59CB\u6599\u672A\u53CA", "\u5CF0\u56DE\u8DEF\u8F6C", "\u67F3\u6697\u82B1\u660E"],
    cool_point: ["\u9006\u88AD", "\u6253\u8138", "\u53CD\u6740", "\u78BE\u538B", "\u6A2A\u626B", "\u626C\u7709\u5410\u6C14", "\u5927\u5FEB\u4EBA\u5FC3", "\u75DB\u5FEB", "\u9738\u6C14"],
    setback: ["\u5931\u8D25", "\u7834\u4EA7", "\u80CC\u53DB", "\u635F\u5931", "\u53D7\u632B", "\u91CD\u521B", "\u7EDD\u671B", "\u5D29\u6E83"],
    climax: ["\u51B3\u6218", "\u7EC8\u6781\u5BF9\u51B3", "\u5DC5\u5CF0\u5BF9\u51B3", "\u751F\u6B7B\u5173\u5934", "\u7834\u91DC\u6C89\u821F", "\u5B64\u6CE8\u4E00\u63B7"]
  },
  waveRhythmKeywords: {
    smallCool: ["\u9006\u88AD", "\u6253\u8138", "\u626C\u7709\u5410\u6C14", "\u8FDB\u5C55"],
    mediumReversal: ["\u53CD\u8F6C", "\u9006\u8F6C", "\u53CD\u6740", "\u51FA\u4E4E\u610F\u6599", "\u5CF0\u56DE\u8DEF\u8F6C"],
    bigClimax: ["\u51B3\u6218", "\u7EC8\u6781\u5BF9\u51B3", "\u5DC5\u5CF0\u5BF9\u51B3", "\u7834\u91DC\u6C89\u821F"]
  }
};

// engine/genre/genre-presets/generic.genre.json
var generic_genre_default = {
  genreId: "generic",
  displayName: "\u901A\u7528",
  behaviorTraits: [
    { word: "\u5927\u7B11", trait: "\u5F00\u6717" },
    { word: "\u6012", trait: "\u6613\u6012" },
    { word: "\u54ED", trait: "\u611F\u6027" },
    { word: "\u6C89\u601D", trait: "\u7406\u6027" },
    { word: "\u5FAE\u7B11", trait: "\u6E29\u548C" }
  ],
  abilityKeywords: ["\u80FD\u529B", "\u624D\u80FD", "\u64C5\u957F", "\u7CBE\u901A", "\u638C\u63E1"],
  techniqueKeywords: ["\u4F0F\u7B14", "\u8F6C\u6298", "\u9AD8\u6F6E", "\u51B2\u7A81", "\u60AC\u5FF5"],
  foreshadowTypes: ["\u4F0F\u7B14", "\u6697\u793A", "\u9884\u5146"],
  conflictKeywords: ["\u51B2\u7A81", "\u4E89\u5435", "\u6218\u6597", "\u5BF9\u5CD9"],
  showSignalWords: ["\u770B", "\u542C", "\u95FB", "\u8BF4", "\u7B11", "\u54ED", "\u60F3", "\u505A", "\u8D70", "\u8DD1"],
  styleKeywords: ["\u5E73\u5B9E", "\u751F\u52A8", "\u6D41\u7545"],
  detectorSignals: [],
  tensionKeywords: {
    conflict: ["\u6218\u6597", "\u5BF9\u51B3", "\u4EA4\u624B", "\u53AE\u6740", "\u6FC0\u6218", "\u4EA4\u950B", "\u5BF9\u9635", "\u51B3\u6597", "\u5355\u6311", "\u5927\u6218", "\u4E89\u5435", "\u4E89\u6267", "\u5BF9\u5CD9", "\u6012\u89C6", "\u5475\u65A5", "\u6012\u543C"],
    suspense: ["\u7A76\u7ADF", "\u5230\u5E95", "\u96BE\u9053", "\u6B8A\u4E0D\u77E5", "\u672A\u66FE\u60F3", "\u6CA1\u60F3\u5230", "\u7ADF\u7136", "\u5C45\u7136", "\u795E\u79D8", "\u8BE1\u5F02", "\u8E4A\u8DF7", "\u53E4\u602A", "\u4E0D\u5BF9\u52B2", "\u53EF\u7591", "\u79BB\u5947", "\u771F\u76F8", "\u8C1C\u56E2", "\u7591\u56E2", "\u60AC\u5FF5", "\u7591\u60D1"],
    reversal: ["\u7136\u800C", "\u4F46\u662F", "\u4E0D\u6599", "\u6CA1\u60F3\u5230", "\u8C01\u77E5", "\u5C82\u6599", "\u54EA\u77E5", "\u8F6C\u5FF5\u4E00\u60F3", "\u5C31\u5728\u8FD9\u65F6", "\u7A81\u7136", "\u9AA4\u7136", "\u731D\u7136", "\u9661\u7136", "\u84E6\u7136", "\u5FFD\u7136", "\u731B\u7136", "\u51FA\u4E4E\u610F\u6599", "\u610F\u6599\u4E4B\u5916", "\u59CB\u6599\u672A\u53CA", "\u610F\u60F3\u4E0D\u5230", "\u53CD\u8F6C", "\u9006\u8F6C", "\u7FFB\u76D8", "\u5CF0\u56DE\u8DEF\u8F6C", "\u67F3\u6697\u82B1\u660E"],
    cool_point: ["\u5927\u80DC", "\u5B8C\u80DC", "\u53CD\u6740", "\u6253\u8138", "\u78BE\u538B", "\u79D2\u6740", "\u6A2A\u626B", "\u6467\u67AF\u62C9\u673D", "\u52BF\u5982\u7834\u7AF9", "\u6240\u5411\u62AB\u9761", "\u626C\u7709\u5410\u6C14", "\u5927\u5FEB\u4EBA\u5FC3", "\u75DB\u5FEB", "\u723D", "\u5389\u5BB3", "\u725B\u903C", "\u65E0\u654C", "\u9738\u6C14", "\u7A81\u7834", "\u5347\u7EA7", "\u987F\u609F", "\u626E\u732A\u5403\u864E", "\u6DF1\u85CF\u4E0D\u9732"],
    setback: ["\u60E8\u8D25", "\u5927\u8D25", "\u6E83\u8D25", "\u5931\u5229", "\u53D7\u4F24", "\u91CD\u4F24", "\u9668\u843D", "\u727A\u7272", "\u635F\u5931", "\u4EE3\u4EF7", "\u5669\u8017", "\u8D25\u9000", "\u8D25\u5317", "\u53D7\u632B", "\u632B\u8D25", "\u6253\u51FB", "\u91CD\u521B", "\u5FC3\u5982\u5200\u5272", "\u4E07\u5FF5\u4FF1\u7070", "\u8D70\u6295\u65E0\u8DEF", "\u7EDD\u671B", "\u5D29\u6E83", "\u5FC3\u788E", "\u75DB\u82E6", "\u60B2\u4F24"],
    climax: ["\u51B3\u6218", "\u7EC8\u6781", "\u6700\u7EC8", "\u751F\u6B7B\u4E4B\u6218", "\u5BBF\u547D\u5BF9\u51B3", "\u7EC8\u6781\u4E00\u6218", "\u5927\u7ED3\u5C40", "\u7EC8\u5C40", "\u5DC5\u5CF0\u5BF9\u51B3", "\u6700\u540E\u4E00\u6218", "\u51B3\u4E00\u6B7B\u6218", "\u751F\u6B7B\u5173\u5934", "\u5343\u94A7\u4E00\u53D1", "\u547D\u60AC\u4E00\u7EBF", "\u751F\u6B7B\u5B58\u4EA1", "\u80CC\u6C34\u4E00\u6218", "\u7834\u91DC\u6C89\u821F", "\u5B64\u6CE8\u4E00\u63B7"]
  },
  waveRhythmKeywords: {
    smallCool: ["\u7A81\u7834", "\u5347\u7EA7", "\u987F\u609F", "\u83B7\u5F97", "\u5F97\u5230", "\u6536\u83B7", "\u6253\u8138", "\u626C\u7709\u5410\u6C14"],
    mediumReversal: ["\u53CD\u8F6C", "\u9006\u8F6C", "\u53CD\u6740", "\u51FA\u4E4E\u610F\u6599", "\u5CF0\u56DE\u8DEF\u8F6C", "\u67F3\u6697\u82B1\u660E"],
    bigClimax: ["\u51B3\u6218", "\u7EC8\u6781\u4E00\u6218", "\u5BBF\u547D\u5BF9\u51B3", "\u751F\u6B7B\u5B58\u4EA1", "\u5DC5\u5CF0\u5BF9\u51B3", "\u7834\u91DC\u6C89\u821F"]
  }
};

// engine/genre/genre-config-registry.ts
var BUILTIN_PRESETS = [
  cultivation_genre_default,
  military_genre_default,
  romance_genre_default,
  mystery_genre_default,
  scifi_genre_default,
  wuxia_genre_default,
  history_genre_default,
  fantasy_genre_default,
  urban_genre_default,
  generic_genre_default
].map((p) => ({ ...p }));
var GenreConfigRegistry = class _GenreConfigRegistry {
  constructor() {
    this.configs = /* @__PURE__ */ new Map();
    this.customLoader = null;
    this.customLoaded = false;
    for (const preset of BUILTIN_PRESETS) {
      this.configs.set(preset.genreId, preset);
    }
  }
  static {
    this.instance = null;
  }
  static getInstance() {
    if (!_GenreConfigRegistry.instance) {
      _GenreConfigRegistry.instance = new _GenreConfigRegistry();
    }
    return _GenreConfigRegistry.instance;
  }
  /**
   * 仅供单元测试重置单例状态使用，生产代码不要调用。
   */
  static resetInstance() {
    _GenreConfigRegistry.instance = null;
  }
  /**
   * 注册单个自定义配置。同 genreId 时覆盖内置配置。
   */
  registerCustomConfig(config) {
    this.configs.set(config.genreId, { ...config });
  }
  /**
   * 批量注册自定义配置。同 genreId 时覆盖内置配置。
   */
  loadCustomConfigs(configs) {
    for (const config of configs) {
      this.registerCustomConfig(config);
    }
  }
  /**
   * 设置自定义配置加载器（生产环境由 main.ts 注入，从 vault 读取 .trae/genres/*.genre.json）。
   * 设置后需调用 reloadCustomConfigs() 才会触发加载。
   */
  setCustomConfigLoader(loader) {
    this.customLoader = loader;
    this.customLoaded = false;
  }
  /**
   * 触发自定义配置加载器，加载自定义配置到注册表。
   */
  async reloadCustomConfigs() {
    if (!this.customLoader) {
      return;
    }
    const configs = await this.customLoader();
    this.loadCustomConfigs(configs);
    this.customLoaded = true;
  }
  /**
   * 按 genreId 查询配置。
   * 未找到时回退到 generic 兜底配置；若 generic 也缺失，抛出错误。
   */
  getGenreConfig(genreId) {
    const config = this.configs.get(genreId);
    if (config) {
      return config;
    }
    const fallback = this.configs.get("generic");
    if (fallback) {
      return fallback;
    }
    throw new Error(`GenreConfig not found: ${genreId} (and generic fallback missing)`);
  }
  /**
   * 列出所有已注册的 genreId。
   */
  listGenreIds() {
    return Array.from(this.configs.keys());
  }
  /**
   * 判断指定 genreId 是否已注册。
   */
  hasGenreConfig(genreId) {
    return this.configs.has(genreId);
  }
};

// engine/llm-prompts.ts
var JSON_SYSTEM_PREFIX = `\u4F60\u662F\u4E00\u540D\u4E13\u4E1A\u7684\u5C0F\u8BF4\u6587\u672C\u5206\u6790\u5E08\u3002\u8BF7\u6839\u636E\u7ED9\u5B9A\u7684\u5C0F\u8BF4\u7247\u6BB5\u548C\u5DF2\u6709\u7684\u7EDF\u8BA1\u7ED3\u679C\uFF0C\u8FDB\u884C\u8BED\u4E49\u63D0\u70BC\u3002
\u4E25\u683C\u8981\u6C42\uFF1A
1. \u53EA\u8F93\u51FA\u4E00\u4E2A JSON \u5BF9\u8C61\uFF0C\u4E0D\u8981\u8F93\u51FA\u4EFB\u4F55\u89E3\u91CA\u6027\u6587\u5B57\u3001Markdown \u4EE3\u7801\u5757\u6216\u524D\u540E\u7F00
2. \u4E0D\u786E\u5B9A\u65F6\u8FD4\u56DE\u7A7A\u6570\u7EC4\u6216\u7A7A\u5B57\u7B26\u4E32\uFF0C\u7981\u6B62\u7F16\u9020
3. \u63D0\u70BC\u7684\u5185\u5BB9\u5FC5\u987B\u57FA\u4E8E\u7ED9\u5B9A\u6587\u672C\uFF0C\u4E0D\u8981\u5F15\u5165\u5916\u90E8\u77E5\u8BC6
4. \u8F93\u51FA\u5FC5\u987B\u662F\u5408\u6CD5\u7684 JSON`;
function buildPersonalityPrompt(text, _genreConfig, existing) {
  return {
    systemPrompt: `${JSON_SYSTEM_PREFIX}

\u4EFB\u52A1\uFF1A\u4ECE\u5C0F\u8BF4\u7247\u6BB5\u4E2D\u63D0\u70BC\u4E3B\u89D2\u7684\u6027\u683C\u6807\u7B7E\u3002
\u8F93\u51FA JSON \u7ED3\u6784\uFF1A{"personality": string[], "evidence": string[]}
- personality: 3-8 \u4E2A\u6027\u683C\u6807\u7B7E\uFF08\u5982"\u51B7\u9759"\u3001"\u679C\u65AD"\u3001"\u91CD\u60C5\u4E49"\uFF09\uFF0C\u7B80\u6D01\u7684\u4E8C\u5B57\u6216\u56DB\u5B57\u8BCD\u7EC4
- evidence: \u5BF9\u5E94\u6027\u683C\u6807\u7B7E\u7684\u6587\u672C\u8BC1\u636E\u7247\u6BB5\uFF08\u6BCF\u4E2A\u4E0D\u8D85\u8FC7 30 \u5B57\uFF09`,
    userPrompt: `\u5C0F\u8BF4\u7247\u6BB5\uFF1A
${text}

\u5DF2\u6709\u7EDF\u8BA1\u7ED3\u679C\uFF08\u53C2\u8003\uFF0C\u53EF\u80FD\u4E3A\u7A7A\uFF09\uFF1A
${existing ? JSON.stringify(existing).slice(0, 800) : "\uFF08\u65E0\uFF09"}

\u8BF7\u8F93\u51FA JSON\uFF1A`
  };
}
function buildAbilitiesPrompt(text, _genreConfig, existing) {
  return {
    systemPrompt: `${JSON_SYSTEM_PREFIX}

\u4EFB\u52A1\uFF1A\u4ECE\u5C0F\u8BF4\u7247\u6BB5\u4E2D\u63D0\u70BC\u4EBA\u7269\u7684\u80FD\u529B\u4F53\u7CFB\u3002
\u8F93\u51FA JSON \u7ED3\u6784\uFF1A{"abilities": string[], "categories": string[]}
- abilities: 5-15 \u4E2A\u5177\u4F53\u80FD\u529B\u540D\uFF08\u5982"\u5251\u672F"\u3001"\u706B\u7CFB\u6CD5\u672F"\u3001"\u8BFB\u5FC3\u672F"\uFF09\uFF0C\u57FA\u4E8E\u6587\u672C\u8BC1\u636E
- categories: \u80FD\u529B\u6240\u5C5E\u5927\u7C7B\uFF08\u5982"\u6B66\u6280"\u3001"\u6CD5\u672F"\u3001"\u5FC3\u667A"\uFF09\uFF0C2-5 \u4E2A`,
    userPrompt: `\u5C0F\u8BF4\u7247\u6BB5\uFF1A
${text}

\u5DF2\u6709\u7EDF\u8BA1\u7ED3\u679C\uFF08\u53C2\u8003\uFF0C\u53EF\u80FD\u4E3A\u7A7A\uFF09\uFF1A
${existing ? JSON.stringify(existing).slice(0, 800) : "\uFF08\u65E0\uFF09"}

\u8BF7\u8F93\u51FA JSON\uFF1A`
  };
}
function buildGoalsPrompt(text, _genreConfig, existing) {
  return {
    systemPrompt: `${JSON_SYSTEM_PREFIX}

\u4EFB\u52A1\uFF1A\u4ECE\u5C0F\u8BF4\u7247\u6BB5\u4E2D\u63D0\u70BC\u4EBA\u7269\u76EE\u6807\u3002
\u8F93\u51FA JSON \u7ED3\u6784\uFF1A{"shortTermGoals": string[], "longTermGoal": string}
- shortTermGoals: 1-5 \u4E2A\u77ED\u671F\u76EE\u6807\uFF08\u6BCF\u4E2A\u4E0D\u8D85\u8FC7 20 \u5B57\uFF09
- longTermGoal: \u4E00\u4E2A\u957F\u671F\u76EE\u6807\uFF08\u4E0D\u8D85\u8FC7 30 \u5B57\uFF09\uFF0C\u65E0\u5219\u7559\u7A7A\u5B57\u7B26\u4E32`,
    userPrompt: `\u5C0F\u8BF4\u7247\u6BB5\uFF1A
${text}

\u5DF2\u6709\u7EDF\u8BA1\u7ED3\u679C\uFF08\u53C2\u8003\uFF0C\u53EF\u80FD\u4E3A\u7A7A\uFF09\uFF1A
${existing ? JSON.stringify(existing).slice(0, 800) : "\uFF08\u65E0\uFF09"}

\u8BF7\u8F93\u51FA JSON\uFF1A`
  };
}
function buildStylePrompt(text, _genreConfig, existing) {
  return {
    systemPrompt: `${JSON_SYSTEM_PREFIX}

\u4EFB\u52A1\uFF1A\u4ECE\u5C0F\u8BF4\u7247\u6BB5\u4E2D\u63D0\u70BC\u5199\u4F5C\u98CE\u683C\u7279\u5F81\u3002
\u8F93\u51FA JSON \u7ED3\u6784\uFF1A{"styleKeywords": string[], "rhetoricFeatures": string[]}
- styleKeywords: 5-12 \u4E2A\u98CE\u683C\u5173\u952E\u8BCD\uFF08\u5982"\u767D\u63CF"\u3001"\u53E4\u98CE"\u3001"\u5FEB\u8282\u594F"\u3001"\u91CD\u6292\u60C5"\uFF09
- rhetoricFeatures: 2-6 \u4E2A\u4FEE\u8F9E\u7279\u5F81\uFF08\u5982"\u6BD4\u55BB\u5BC6\u96C6"\u3001"\u5BF9\u4ED7\u5DE5\u6574"\u3001"\u5938\u5F20"")`,
    userPrompt: `\u5C0F\u8BF4\u7247\u6BB5\uFF1A
${text}

\u5DF2\u6709\u7EDF\u8BA1\u7ED3\u679C\uFF08\u53C2\u8003\uFF0C\u53EF\u80FD\u4E3A\u7A7A\uFF09\uFF1A
${existing ? JSON.stringify(existing).slice(0, 800) : "\uFF08\u65E0\uFF09"}

\u8BF7\u8F93\u51FA JSON\uFF1A`
  };
}
function buildRhythmPrompt(text, _genreConfig, existing) {
  return {
    systemPrompt: `${JSON_SYSTEM_PREFIX}

\u4EFB\u52A1\uFF1A\u4ECE\u5C0F\u8BF4\u7247\u6BB5\u4E2D\u8BC6\u522B\u5173\u952E\u4E8B\u4EF6\u548C\u8282\u594F\u3002
\u8F93\u51FA JSON \u7ED3\u6784\uFF1A{"events": [{"description": string, "type": string}], "pacing": string}
- events: 3-10 \u4E2A\u5173\u952E\u4E8B\u4EF6\uFF0Cdescription \u4E0D\u8D85\u8FC7 30 \u5B57\uFF0Ctype \u4E3A"\u51B2\u7A81"/"\u8F6C\u6298"/"\u9AD8\u6F6E"/"\u94FA\u57AB"/"\u8FC7\u6E21"\u4E4B\u4E00
- pacing: \u6574\u4F53\u8282\u594F\u63CF\u8FF0\uFF08\u5982"\u7D27\u51D1"\u3001"\u8212\u7F13"\u3001"\u5F20\u5F1B\u6709\u5EA6"\uFF09\uFF0C\u4E0D\u8D85\u8FC7 10 \u5B57`,
    userPrompt: `\u5C0F\u8BF4\u7247\u6BB5\uFF1A
${text}

\u5DF2\u6709\u7EDF\u8BA1\u7ED3\u679C\uFF08\u53C2\u8003\uFF0C\u53EF\u80FD\u4E3A\u7A7A\uFF09\uFF1A
${existing ? JSON.stringify(existing).slice(0, 800) : "\uFF08\u65E0\uFF09"}

\u8BF7\u8F93\u51FA JSON\uFF1A`
  };
}
function buildForeshadowPrompt(text, _genreConfig, existing) {
  return {
    systemPrompt: `${JSON_SYSTEM_PREFIX}

\u4EFB\u52A1\uFF1A\u4ECE\u5C0F\u8BF4\u7247\u6BB5\u4E2D\u8BC6\u522B\u6F5C\u5728\u7684\u4F0F\u7B14\u3002
\u8F93\u51FA JSON \u7ED3\u6784\uFF1A{"foreshadows": [{"hint": string, "type": string, "confidence": number}]}
- foreshadows: 0-8 \u4E2A\u4F0F\u7B14
  - hint: \u4F0F\u7B14\u63CF\u8FF0\uFF08\u4E0D\u8D85\u8FC7 40 \u5B57\uFF09
  - type: "\u7269\u4EF6"/"\u5BF9\u8BDD"/"\u73AF\u5883"/"\u4EBA\u7269"/"\u4E8B\u4EF6"\u4E4B\u4E00
  - confidence: 0-1 \u4E4B\u95F4\u7684\u6D6E\u70B9\u6570\uFF08\u4FDD\u7559 2 \u4F4D\u5C0F\u6570\uFF09`,
    userPrompt: `\u5C0F\u8BF4\u7247\u6BB5\uFF1A
${text}

\u5DF2\u6709\u7EDF\u8BA1\u7ED3\u679C\uFF08\u53C2\u8003\uFF0C\u53EF\u80FD\u4E3A\u7A7A\uFF09\uFF1A
${existing ? JSON.stringify(existing).slice(0, 800) : "\uFF08\u65E0\uFF09"}

\u8BF7\u8F93\u51FA JSON\uFF1A`
  };
}
function buildGenrePrompt(text, _genreConfig, existing) {
  return {
    systemPrompt: `${JSON_SYSTEM_PREFIX}

\u4EFB\u52A1\uFF1A\u8BC6\u522B\u5C0F\u8BF4\u7247\u6BB5\u7684\u9898\u6750\u3002
\u53EF\u9009 genreId \u5217\u8868\uFF1Acultivation\uFF08\u4FEE\u4ED9\uFF09, military\uFF08\u519B\u4E8B\uFF09, romance\uFF08\u8A00\u60C5\uFF09, mystery\uFF08\u60AC\u7591\uFF09, scifi\uFF08\u79D1\u5E7B\uFF09, wuxia\uFF08\u6B66\u4FA0\uFF09, history\uFF08\u5386\u53F2\uFF09, fantasy\uFF08\u5947\u5E7B\uFF09, urban\uFF08\u90FD\u5E02\uFF09, generic\uFF08\u901A\u7528/\u65E0\u6CD5\u5224\u65AD\uFF09

\u8F93\u51FA JSON \u7ED3\u6784\uFF1A
{"genreId": string, "displayName": string, "detectorSignals": string[], "keywords": {"abilityKeywords": string[], "styleKeywords": string[], "foreshadowTypes": string[]}}
- genreId: \u5FC5\u987B\u4ECE\u4E0A\u9762\u5217\u8868\u4E2D\u9009\u62E9
- displayName: \u9898\u6750\u4E2D\u6587\u540D
- detectorSignals: 5-15 \u4E2A\u8BC6\u522B\u7279\u5F81\u8BCD\uFF08\u7528\u4E8E\u540E\u7EED\u7EDF\u8BA1\u8BC6\u522B\uFF09
- keywords.abilityKeywords: 5-15 \u4E2A\u80FD\u529B\u5173\u952E\u8BCD
- keywords.styleKeywords: 5-15 \u4E2A\u98CE\u683C\u5173\u952E\u8BCD
- keywords.foreshadowTypes: 3-10 \u4E2A\u4F0F\u7B14\u7C7B\u578B\u5173\u952E\u8BCD`,
    userPrompt: `\u5C0F\u8BF4\u7247\u6BB5\uFF1A
${text}

\u5DF2\u6709\u7EDF\u8BA1\u7ED3\u679C\uFF08\u53C2\u8003\uFF0C\u53EF\u80FD\u4E3A\u7A7A\uFF09\uFF1A
${existing ? JSON.stringify(existing).slice(0, 800) : "\uFF08\u65E0\uFF09"}

\u8BF7\u8F93\u51FA JSON\uFF1A`
  };
}
var PROMPT_BUILDERS = {
  personality: buildPersonalityPrompt,
  abilities: buildAbilitiesPrompt,
  goals: buildGoalsPrompt,
  style: buildStylePrompt,
  rhythm: buildRhythmPrompt,
  foreshadow: buildForeshadowPrompt,
  genre: buildGenrePrompt
};
function getDimensionPrompt(dimension, text, genreConfig, existingResult) {
  const builder = PROMPT_BUILDERS[dimension];
  return builder(text, genreConfig, existingResult);
}

// shared/logger.ts
var LOG_LEVEL_PRIORITY = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  silent: 4
};
var globalLogLevel = "warn";
function createLogger(scope, level) {
  const prefix = `[${scope}]`;
  const shouldLog = (msgLevel) => {
    const effectiveLevel = level ?? globalLogLevel;
    return LOG_LEVEL_PRIORITY[msgLevel] >= LOG_LEVEL_PRIORITY[effectiveLevel];
  };
  return {
    debug(...args) {
      if (shouldLog("debug"))
        console.log(prefix, ...args);
    },
    info(...args) {
      if (shouldLog("info"))
        console.log(prefix, ...args);
    },
    warn(...args) {
      if (shouldLog("warn"))
        console.warn(prefix, ...args);
    },
    error(...args) {
      if (shouldLog("error"))
        console.error(prefix, ...args);
    },
    child(childScope) {
      return createLogger(`${scope}:${childScope}`, level);
    }
  };
}

// engine/llm-enhancer.ts
var log = createLogger("LlmEnhancer");
var LLM_DEGRADED = Symbol("llm_degraded");
var DEFAULT_TEMPERATURE = 0.3;
var DEFAULT_MAX_TOKENS = 2048;
var LLMEnhancer = class {
  constructor(caller, options) {
    this.caller = caller;
    this.options = options ?? {};
  }
  /**
   * 通用 LLM 增强方法。
   *
   * 流程：
   * 1. 根据 dimension 构建提示词
   * 2. 调用 LLM
   * 3. 解析 JSON
   * 4. 失败时返回 existingResult（fallbackUsed=true）
   *
   * 异常处理：任何异常（网络/解析/超时）都降级返回 existingResult，记录警告。
   */
  async enhanceWithLLM(context) {
    const { dimension, text, genreConfig, existingResult } = context;
    if (!text || text.trim().length === 0) {
      return {
        dimension,
        success: false,
        fallbackUsed: true,
        fallbackData: existingResult,
        error: "empty text"
      };
    }
    try {
      const { systemPrompt, userPrompt } = getDimensionPrompt(
        dimension,
        text,
        genreConfig,
        existingResult
      );
      const response = await this.caller.callAI(
        systemPrompt,
        userPrompt,
        this.options.llmModel,
        this.options.temperature ?? DEFAULT_TEMPERATURE,
        this.options.maxTokens ?? DEFAULT_MAX_TOKENS
      );
      if (response.error) {
        log.warn(`[LLMEnhancer] ${dimension} LLM \u8C03\u7528\u8FD4\u56DE\u9519\u8BEF: ${response.error}\uFF0C\u964D\u7EA7\u5230\u7EAF\u7EDF\u8BA1\u7ED3\u679C`);
        return {
          dimension,
          success: false,
          fallbackUsed: true,
          fallbackData: existingResult,
          error: response.error
        };
      }
      const data = this.parseJSONResponse(response.content);
      if (data === null) {
        log.warn(`[LLMEnhancer] ${dimension} LLM \u8FD4\u56DE\u5185\u5BB9\u65E0\u6CD5\u89E3\u6790\u4E3A JSON\uFF0C\u964D\u7EA7\u5230\u7EAF\u7EDF\u8BA1\u7ED3\u679C`);
        return {
          dimension,
          success: false,
          fallbackUsed: true,
          fallbackData: existingResult,
          error: "invalid JSON response"
        };
      }
      return {
        dimension,
        success: true,
        data,
        fallbackUsed: false
      };
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      log.warn(`[LLMEnhancer] ${dimension} LLM \u589E\u5F3A\u5F02\u5E38\uFF0C\u964D\u7EA7\u5230\u7EAF\u7EDF\u8BA1\u7ED3\u679C:`, errMsg);
      return {
        dimension,
        success: false,
        fallbackUsed: true,
        fallbackData: existingResult,
        error: errMsg
      };
    }
  }
  /**
   * 便捷方法：增强并合并到现有结果。
   *
   * 调用 enhanceWithLLM，成功时浅合并 data 到 result，失败时原样返回 result。
   * 适用于 deconstructor 在 analyze 末尾的可选调用。
   */
  async enhanceResult(result, text, dimension, genreConfig) {
    const enhanced = await this.enhanceWithLLM({
      dimension,
      text,
      genreConfig,
      existingResult: result
    });
    if (enhanced.success && enhanced.data && typeof enhanced.data === "object") {
      return { ...result, ...enhanced.data };
    }
    Object.defineProperty(result, LLM_DEGRADED, { value: true, enumerable: false });
    return result;
  }
  /**
   * 解析 LLM 返回的 JSON。
   *
   * 容错处理：
   * - 去除可能的 Markdown 代码块包裹（```json ... ```）
   * - 去除前后空白和非 JSON 字符
   * - 解析失败返回 null
   */
  parseJSONResponse(content) {
    if (!content || typeof content !== "string") {
      return null;
    }
    let trimmed = content.trim();
    if (trimmed.startsWith("```")) {
      trimmed = trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "");
    }
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) {
      return null;
    }
    const jsonStr = trimmed.slice(start, end + 1);
    try {
      return JSON.parse(jsonStr);
    } catch {
      return null;
    }
  }
  /**
   * 静态工具：为指定维度构建上下文摘要。
   *
   * 各维度的取样策略：
   * - personality/abilities: 取段落按角色密度排序，取前 3-5 段
   * - style: 取首章首段 + 中段 + 尾段
   * - rhythm: 取章节首尾段落
   * - foreshadow: 取伏笔候选上下文（简单方案：取首中尾段）
   * - goals/genre: 取文本前 500 字（默认）
   *
   * @param dimension 维度名
   * @param fullText 完整文本
   * @param paragraphs 段落数组（可选，未提供时按 \\n\\n 切分）
   * @returns 200-500 字的上下文摘要
   */
  static buildContextForDimension(dimension, fullText, paragraphs) {
    if (!fullText)
      return "";
    const paras = paragraphs ?? fullText.split(/\n\n+/).map((p) => p.trim()).filter(Boolean);
    if (paras.length === 0)
      return fullText.slice(0, 500);
    const MAX_CHARS = 500;
    switch (dimension) {
      case "personality":
      case "abilities": {
        const count = Math.min(5, paras.length);
        return paras.slice(0, count).join("\n\n").slice(0, MAX_CHARS);
      }
      case "style": {
        const head = paras[0] ?? "";
        const mid = paras[Math.floor(paras.length / 2)] ?? "";
        const tail = paras[paras.length - 1] ?? "";
        return [head, mid, tail].join("\n\n").slice(0, MAX_CHARS);
      }
      case "rhythm": {
        const head = paras.slice(0, 2).join("\n\n");
        const tail = paras.slice(-2).join("\n\n");
        return `${head}

...

${tail}`.slice(0, MAX_CHARS);
      }
      case "foreshadow":
      case "goals":
      case "genre":
      default: {
        return fullText.slice(0, MAX_CHARS);
      }
    }
  }
};

// engine/genre/genre-detector.ts
var log2 = createLogger("GenreDetector");
var SAMPLE_SIZE = 5e3;
var CONFIDENCE_THRESHOLD = 0.4;
var SECONDARY_RATIO_THRESHOLD = 0.7;
var GenreDetector = class {
  constructor(registry) {
    this.registry = registry ?? GenreConfigRegistry.getInstance();
  }
  /**
   * 识别文本题材。
   */
  detect(text) {
    if (!text || text.length === 0) {
      return { genreId: "generic", confidence: 0 };
    }
    const sample = text.length > SAMPLE_SIZE ? text.slice(0, SAMPLE_SIZE) : text;
    const genreHits = [];
    for (const genreId of this.registry.listGenreIds()) {
      const config = this.registry.getGenreConfig(genreId);
      if (!config.detectorSignals || config.detectorSignals.length === 0) {
        continue;
      }
      const hits = this.countKeywordHits(sample, config.detectorSignals);
      if (hits > 0) {
        genreHits.push({ genreId, hits });
      }
    }
    const totalHits = genreHits.reduce((sum, g) => sum + g.hits, 0);
    if (totalHits === 0) {
      return { genreId: "generic", confidence: 0 };
    }
    genreHits.sort((a, b) => b.hits - a.hits);
    const primary = genreHits[0];
    const confidence = primary.hits / totalHits;
    if (confidence < CONFIDENCE_THRESHOLD) {
      return { genreId: "generic", confidence: 0 };
    }
    const secondary = this.pickSecondary(genreHits);
    if (secondary) {
      return {
        genreId: primary.genreId,
        confidence,
        primary: primary.genreId,
        secondary
      };
    }
    return { genreId: primary.genreId, confidence };
  }
  /**
   * 选择次识别题材。规则：次题材命中数 / 主题材命中数 >= 0.7 时返回其 genreId。
   */
  pickSecondary(genreHits) {
    if (genreHits.length < 2) {
      return void 0;
    }
    const primary = genreHits[0];
    const second = genreHits[1];
    if (primary.hits === 0) {
      return void 0;
    }
    if (second.hits / primary.hits >= SECONDARY_RATIO_THRESHOLD) {
      return second.genreId;
    }
    return void 0;
  }
  /**
   * 统计关键词列表在文本中的总命中次数（每个关键词出现 N 次累加 N）。
   */
  countKeywordHits(text, keywords) {
    let total = 0;
    for (const kw of keywords) {
      if (!kw)
        continue;
      total += this.countOccurrences(text, kw);
    }
    return total;
  }
  /**
   * 统计子串在文本中出现次数（非重叠计数）。
   */
  countOccurrences(text, sub) {
    if (!sub)
      return 0;
    let count = 0;
    let pos = 0;
    while (true) {
      const idx = text.indexOf(sub, pos);
      if (idx === -1)
        break;
      count++;
      pos = idx + sub.length;
    }
    return count;
  }
  /**
   * LLM 辅助题材识别。
   *
   * 使用场景：纯统计 detect 返回 generic（confidence < 0.4 或无命中）时，
   * 调用 LLM 进行语义级题材识别。
   *
   * 流程：
   * 1. 用 LLMEnhancer 调用 genre 维度提示词
   * 2. 解析返回的 { genreId, displayName, detectorSignals, keywords }
   * 3. 如果 genreId 不在 registry 中，构造新 GenreConfig 并注册
   * 4. 返回 GenreDetectionResult（confidence=0.6，标记为 LLM 识别）
   *
   * 降级：LLM 失败时返回 generic 兜底结果。
   *
   * @param text 待识别文本
   * @param caller LLM 调用器（通常传 AIEngine 实例）
   * @param options 可选配置（模型名等）
   */
  async detectWithLLM(text, caller, options) {
    if (!text || text.length === 0) {
      return { genreId: "generic", confidence: 0 };
    }
    const sample = text.length > SAMPLE_SIZE ? text.slice(0, SAMPLE_SIZE) : text;
    const enhancer = new LLMEnhancer(caller, { llmModel: options?.llmModel });
    const MAX_RETRIES = 1;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        if (attempt > 0) {
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
        const result = await enhancer.enhanceWithLLM({
          dimension: "genre",
          text: sample
        });
        if (!result.success || !result.data) {
          if (attempt < MAX_RETRIES) {
            log2.warn(`[GenreDetector] LLM \u9898\u6750\u8BC6\u522B\u5931\u8D25\uFF08\u7B2C ${attempt + 1} \u6B21\uFF09\uFF0C500ms \u540E\u91CD\u8BD5`);
            continue;
          }
          log2.warn("[GenreDetector] LLM \u9898\u6750\u8BC6\u522B\u5931\u8D25\uFF0C\u964D\u7EA7\u5230 generic");
          return { genreId: "generic", confidence: 0 };
        }
        const identified = result.data;
        const genreId = this.sanitizeGenreId(identified.genreId);
        if (genreId === "generic") {
          return { genreId: "generic", confidence: 0 };
        }
        if (!this.registry.hasGenreConfig(genreId)) {
          const newConfig = this.buildGenreConfigFromLLMResult(identified);
          if (newConfig) {
            this.registry.registerCustomConfig(newConfig);
            log2.info(`[GenreDetector] LLM \u8BC6\u522B\u65B0\u9898\u6750\u5E76\u6CE8\u518C: ${genreId} (${newConfig.displayName})`);
          }
        }
        return {
          genreId,
          confidence: 0.6
        };
      } catch (e) {
        if (attempt < MAX_RETRIES) {
          log2.warn(`[GenreDetector] LLM \u9898\u6750\u8BC6\u522B\u5F02\u5E38\uFF08\u7B2C ${attempt + 1} \u6B21\uFF09\uFF0C500ms \u540E\u91CD\u8BD5:`, e);
        } else {
          log2.warn("[GenreDetector] LLM \u9898\u6750\u8BC6\u522B\u5F02\u5E38\uFF0C\u964D\u7EA7\u5230 generic:", e);
          return { genreId: "generic", confidence: 0 };
        }
      }
    }
    return { genreId: "generic", confidence: 0 };
  }
  /**
   * 校验 genreId 是否合法。非内置 genreId 但符合命名规范时也允许。
   */
  sanitizeGenreId(raw) {
    if (typeof raw !== "string" || !raw) {
      return "generic";
    }
    const trimmed = raw.trim().toLowerCase();
    if (/^[a-z0-9_]{1,32}$/.test(trimmed)) {
      return trimmed;
    }
    return "generic";
  }
  /**
   * 从 LLM 返回结果构造 GenreConfig。返回 null 表示数据不完整。
   */
  buildGenreConfigFromLLMResult(data) {
    const genreId = this.sanitizeGenreId(data.genreId);
    if (genreId === "generic") {
      return null;
    }
    const displayName = typeof data.displayName === "string" && data.displayName.trim() ? data.displayName.trim() : genreId;
    const detectorSignals = Array.isArray(data.detectorSignals) ? data.detectorSignals.filter((s) => typeof s === "string" && s.trim().length > 0).slice(0, 30) : [];
    const keywords = data.keywords ?? {};
    const abilityKeywords = Array.isArray(keywords.abilityKeywords) ? keywords.abilityKeywords.filter((s) => typeof s === "string" && s.trim().length > 0).slice(0, 50) : [];
    const styleKeywords = Array.isArray(keywords.styleKeywords) ? keywords.styleKeywords.filter((s) => typeof s === "string" && s.trim().length > 0).slice(0, 50) : [];
    const foreshadowTypes = Array.isArray(keywords.foreshadowTypes) ? keywords.foreshadowTypes.filter((s) => typeof s === "string" && s.trim().length > 0).slice(0, 30) : [];
    return {
      genreId,
      displayName,
      behaviorTraits: [],
      abilityKeywords,
      techniqueKeywords: [],
      foreshadowTypes,
      conflictKeywords: [],
      showSignalWords: [],
      styleKeywords,
      detectorSignals
    };
  }
};

// engine/deconstructors/style-deconstructor.ts
var log3 = createLogger("StyleDeconstructor");
var MODAL_PARTICLES = ["\u554A", "\u5427", "\u5462", "\u5417", "\u561B", "\u54E6", "\u55EF", "\u54C8", "\u5440", "\u5566", "\u5457", "\u54E9", "\u55BD", "\u7F62\u4E86"];
var VERB_KEYWORDS = [
  "\u8BF4",
  "\u9053",
  "\u770B",
  "\u542C",
  "\u60F3",
  "\u8D70",
  "\u8DD1",
  "\u8DF3",
  "\u6253",
  "\u6740",
  "\u780D",
  "\u5288",
  "\u523A",
  "\u6325",
  "\u51B2",
  "\u9000",
  "\u8EB2",
  "\u6321",
  "\u8DC3",
  "\u843D",
  "\u62FF",
  "\u653E",
  "\u63A8",
  "\u62C9",
  "\u6293",
  "\u63E1",
  "\u6254",
  "\u629B",
  "\u63A5",
  "\u9001",
  "\u5403",
  "\u559D",
  "\u7761",
  "\u9192",
  "\u5750",
  "\u7AD9",
  "\u8EBA",
  "\u8DEA",
  "\u8DB4",
  "\u8E72"
];
var ADJECTIVE_KEYWORDS = [
  "\u7F8E\u4E3D",
  "\u6F02\u4EAE",
  "\u82F1\u4FCA",
  "\u5E05\u6C14",
  "\u9AD8\u5927",
  "\u77EE\u5C0F",
  "\u5F3A\u58EE",
  "\u7626\u5F31",
  "\u806A\u660E",
  "\u611A\u8822",
  "\u5584\u826F",
  "\u90AA\u6076",
  "\u52C7\u6562",
  "\u61E6\u5F31",
  "\u6E29\u67D4",
  "\u51B7\u9177",
  "\u70ED\u60C5",
  "\u51B7\u6F20",
  "\u5F00\u5FC3",
  "\u96BE\u8FC7",
  "\u6124\u6012",
  "\u5E73\u9759",
  "\u7D27\u5F20",
  "\u653E\u677E",
  "\u534E\u4E3D",
  "\u6734\u7D20",
  "\u8C6A\u534E",
  "\u7B80\u964B",
  "\u5E72\u51C0",
  "\u80AE\u810F",
  "\u660E\u4EAE",
  "\u9ED1\u6697"
];
var ADVERB_KEYWORDS = [
  "\u975E\u5E38",
  "\u5341\u5206",
  "\u6781\u5176",
  "\u683C\u5916",
  "\u7279\u522B",
  "\u76F8\u5F53",
  "\u5F88",
  "\u6700",
  "\u66F4",
  "\u6BD4\u8F83",
  "\u5FFD\u7136",
  "\u7A81\u7136",
  "\u6E10\u6E10",
  "\u6162\u6162",
  "\u7F13\u7F13",
  "\u8FC5\u901F",
  "\u5FEB\u901F",
  "\u7ACB\u5373",
  "\u9A6C\u4E0A",
  "\u987F\u65F6",
  "\u8F7B\u8F7B\u5730",
  "\u6084\u6084\u5730",
  "\u9ED8\u9ED8\u5730",
  "\u6DF1\u6DF1\u5730",
  "\u7262\u7262\u5730",
  "\u7D27\u7D27\u5730",
  "\u72E0\u72E0\u5730",
  "\u6DE1\u6DE1"
];
var APPEARANCE_KEYWORDS = [
  "\u957F\u5F97",
  "\u76F8\u8C8C",
  "\u9762\u5BB9",
  "\u8EAB\u6750",
  "\u5BB9\u8C8C",
  "\u7709\u76EE",
  "\u773C\u795E",
  "\u6C14\u8D28",
  "\u8EAB\u7740",
  "\u7A7F\u7740",
  "\u8138\u4E0A",
  "\u7709\u5B87",
  "\u4E94\u5B98",
  "\u76AE\u80A4",
  "\u5934\u53D1",
  "\u8EAB\u59FF",
  "\u8EAB\u5F62",
  "\u5916\u8868",
  "\u5916\u8C8C",
  "\u957F\u76F8"
];
var ENVIRONMENT_KEYWORDS = [
  "\u5929\u7A7A",
  "\u5927\u5730",
  "\u5C71\u5DDD",
  "\u6CB3\u6D41",
  "\u68EE\u6797",
  "\u57CE\u5E02",
  "\u8857\u9053",
  "\u623F\u95F4",
  "\u5BAB\u6BBF",
  "\u5C71\u8C37",
  "\u9633\u5149",
  "\u6708\u5149",
  "\u661F\u5149",
  "\u98CE\u96E8",
  "\u96F7\u7535",
  "\u4E91\u96FE",
  "\u82B1\u8349",
  "\u6811\u6728",
  "\u5EFA\u7B51",
  "\u666F\u8272"
];
var ACTION_KEYWORDS = [
  "\u8DD1",
  "\u8DF3",
  "\u6253",
  "\u780D",
  "\u523A",
  "\u6325",
  "\u51B2",
  "\u9000",
  "\u8EB2",
  "\u6321",
  "\u8DC3",
  "\u843D",
  "\u653B",
  "\u9632",
  "\u51FB",
  "\u8E22",
  "\u6454",
  "\u63A8",
  "\u62C9",
  "\u6293",
  "\u634F",
  "\u63E1",
  "\u65A9",
  "\u7838",
  "\u7529",
  "\u6251",
  "\u54AC",
  "\u6495",
  "\u626F",
  "\u62FD"
];
var PSYCHOLOGY_KEYWORDS = [
  "\u5FC3\u60F3",
  "\u6697\u9053",
  "\u6697\u60F3",
  "\u89C9\u5F97",
  "\u8BA4\u4E3A",
  "\u77E5\u9053",
  "\u660E\u767D",
  "\u611F\u89C9",
  "\u611F\u5230",
  "\u601D\u7D22",
  "\u601D\u8003",
  "\u8003\u8651",
  "\u7422\u78E8",
  "\u601D\u91CF",
  "\u76D8\u7B97",
  "\u731C\u6D4B",
  "\u6000\u7591",
  "\u76F8\u4FE1",
  "\u62C5\u5FC3"
];
var METAPHOR_KEYWORDS = ["\u50CF", "\u5982", "\u4F3C", "\u4EFF\u4F5B", "\u72B9\u5982", "\u597D\u6BD4", "\u5B9B\u5982", "\u5B9B\u82E5", "\u5982\u540C", "\u597D\u4F3C"];
var RHETORICAL_QUESTION_KEYWORDS = ["\u96BE\u9053", "\u5C82", "\u4F55\u4E0D", "\u4F55\u5C1D", "\u4E0D\u662F\u5417", "\u5BF9\u4E0D\u5BF9", "\u662F\u5417", "\u5BF9\u5427"];
var HYPERBOLE_KEYWORDS = ["\u6781\u5EA6", "\u65E0\u6BD4", "\u4E07\u5206", "\u7EDD\u9876", "\u60CA\u5929\u52A8\u5730", "\u6CE3\u9B3C\u795E", "\u5929\u5D29\u5730\u88C2", "\u5730\u52A8\u5C71\u6447"];
var DIALOGUE_PROMPT_WORDS = [
  "\u8BF4",
  "\u9053",
  "\u95EE",
  "\u558A",
  "\u53EB",
  "\u7B54",
  "\u7B11",
  "\u53F9",
  "\u6012\u9053",
  "\u51B7\u7B11",
  "\u4F4E\u8BED",
  "\u5583\u5583",
  "\u8F7B\u58F0",
  "\u5927\u58F0",
  "\u5FC3\u60F3",
  "\u6697\u9053",
  "\u56DE\u7B54",
  "\u56DE\u5E94",
  "\u8BF4\u9053",
  "\u95EE\u9053",
  "\u558A\u9053",
  "\u53EB\u9053"
];
var TIME_OPENING_WORDS = [
  "\u8FD9\u65E5",
  "\u90A3\u65E5",
  "\u6B21\u65E5",
  "\u7FCC\u65E5",
  "\u6E05\u6668",
  "\u508D\u665A",
  "\u6DF1\u591C",
  "\u4E09\u5E74\u540E",
  "\u4E94\u65E5\u540E",
  "\u7B2C\u4E8C\u5929",
  "\u7B2C\u4E09\u5929",
  "\u4E00\u4E2A\u6708\u540E",
  "\u4E00\u5E74\u540E",
  "\u5341\u5E74\u540E",
  "\u6B64\u523B",
  "\u6B64\u65F6",
  "\u8FD9\u65F6",
  "\u90A3\u65F6"
];
var CONJUNCTION_OPENING_WORDS = [
  "\u7136\u800C",
  "\u4F46\u662F",
  "\u4E0D\u8FC7",
  "\u4E8E\u662F",
  "\u56E0\u6B64",
  "\u6240\u4EE5",
  "\u867D\u7136",
  "\u5982\u679C",
  "\u5373\u4F7F",
  "\u51B5\u4E14",
  "\u4F55\u51B5",
  "\u800C\u4E14",
  "\u5E76\u4E14",
  "\u7136\u540E",
  "\u63A5\u7740",
  "\u968F\u540E",
  "\u7EC8\u4E8E",
  "\u6BD5\u7ADF",
  "\u539F\u6765",
  "\u96BE\u602A"
];
var SUBJECT_OPENING_WORDS = ["\u4ED6", "\u5979", "\u5B83", "\u6211", "\u4F60", "\u6211\u4EEC", "\u4F60\u4EEC", "\u4ED6\u4EEC", "\u5979\u4EEC", "\u5B83\u4EEC"];
var COLLOQUIAL_WORDS = [
  "\u6211",
  "\u4F60",
  "\u4ED6",
  "\u8BF4",
  "\u5C31\u662F",
  "\u7136\u540E",
  "\u53EF\u662F",
  "\u4F46\u662F",
  "\u6240\u4EE5",
  "\u56E0\u4E3A",
  "\u5982\u679C",
  "\u554A",
  "\u5427",
  "\u5462",
  "\u5417",
  "\u54E6",
  "\u55EF",
  "\u54C8",
  "\u5440",
  "\u5566",
  "\u5457",
  "\u5565",
  "\u548B",
  "\u600E\u4E48",
  "\u4EC0\u4E48",
  "\u5E72\u561B",
  "\u6CA1\u4E8B\u513F",
  "\u6CA1\u5173\u7CFB",
  "\u4E0D\u597D\u610F\u601D"
];
var STYLE_LABELS = {
  concise: "\u7B80\u6D01",
  gorgeous: "\u534E\u4E3D",
  cold: "\u51B7\u5CFB",
  delicate: "\u7EC6\u817B",
  passionate: "\u70ED\u8840",
  humorous: "\u5E7D\u9ED8",
  heavy: "\u6C89\u91CD",
  relaxed: "\u8F7B\u677E"
};
var SENSE_TYPES = ["visual", "auditory", "olfactory", "gustatory", "tactile"];
var SENSE_LABELS = {
  visual: "\u89C6\u89C9",
  auditory: "\u542C\u89C9",
  olfactory: "\u55C5\u89C9",
  gustatory: "\u5473\u89C9",
  tactile: "\u89E6\u89C9"
};
var VR_LEVEL_LABELS = {
  low: "\u4F4E",
  medium: "\u4E2D",
  high: "\u9AD8"
};
var STYLE_VECTOR_REFERENCES = {
  concise: "\u7B80\u6D01\u6587\u98CE\uFF1A\u6587\u5B57\u7B80\u7EC3\u5E72\u51C0\uFF0C\u77ED\u53E5\u4E3A\u4E3B\uFF0C\u5C11\u4FEE\u9970\u591A\u52A8\u4F5C\uFF0C\u76F4\u5165\u4E3B\u9898\uFF0C\u4E0D\u62D6\u6CE5\u5E26\u6C34\uFF0C\u6BCF\u4E00\u53E5\u8BDD\u90FD\u6709\u4FE1\u606F\u91CF",
  gorgeous: "\u534E\u4E3D\u6587\u98CE\uFF1A\u8F9E\u85FB\u4E30\u5BCC\u4F18\u7F8E\uFF0C\u957F\u53E5\u591A\u4FEE\u9970\u5BC6\uFF0C\u63CF\u5199\u7EC6\u817B\u751F\u52A8\uFF0C\u610F\u5883\u6DF1\u8FDC\uFF0C\u7528\u8BCD\u8BB2\u7A76\u5BCC\u6709\u6587\u91C7",
  cold: "\u51B7\u5CFB\u6587\u98CE\uFF1A\u5BA2\u89C2\u51B7\u9759\u514B\u5236\uFF0C\u7528\u8BCD\u7CBE\u51C6\u7280\u5229\uFF0C\u5C11\u60C5\u7EEA\u591A\u53D9\u8FF0\uFF0C\u7B14\u950B\u9510\u5229\uFF0C\u4E0D\u5E26\u4E2A\u4EBA\u611F\u60C5\u8272\u5F69",
  delicate: "\u7EC6\u817B\u6587\u98CE\uFF1A\u7EC6\u8282\u4E30\u5BCC\u9971\u6EE1\uFF0C\u5FC3\u7406\u63CF\u5199\u6DF1\u5165\uFF0C\u60C5\u611F\u8868\u8FBE\u7EC6\u817B\uFF0C\u8282\u594F\u8212\u7F13\uFF0C\u6CE8\u91CD\u5185\u5FC3\u4E16\u754C\u523B\u753B",
  passionate: "\u70ED\u8840\u6587\u98CE\uFF1A\u6FC0\u60C5\u6F8E\u6E43\u6602\u626C\uFF0C\u52A8\u4F5C\u573A\u9762\u6FC0\u70C8\uFF0C\u60C5\u7EEA\u9AD8\u6DA8\u9971\u6EE1\uFF0C\u8282\u594F\u5FEB\u901F\uFF0C\u5145\u6EE1\u6597\u5FD7\u4E0E\u529B\u91CF\u611F",
  humorous: "\u5E7D\u9ED8\u6587\u98CE\uFF1A\u8BED\u8A00\u8F7B\u677E\u8BD9\u8C10\uFF0C\u7B11\u70B9\u5BC6\u96C6\u6709\u8DA3\uFF0C\u5BF9\u8BDD\u751F\u52A8\u4FCF\u76AE\uFF0C\u8BA9\u4EBA\u4F1A\u5FC3\u4E00\u7B11\uFF0C\u5145\u6EE1\u751F\u6D3B\u8DA3\u5473",
  heavy: "\u6C89\u91CD\u6587\u98CE\uFF1A\u6C1B\u56F4\u538B\u6291\u51DD\u91CD\uFF0C\u60C5\u611F\u6DF1\u6C89\u539A\u91CD\uFF0C\u8282\u594F\u7F13\u6162\u538B\u6291\uFF0C\u5F15\u4EBA\u6DF1\u601D\uFF0C\u5145\u6EE1\u60B2\u5267\u8272\u5F69",
  relaxed: "\u8F7B\u677E\u6587\u98CE\uFF1A\u8282\u594F\u660E\u5FEB\u6109\u60A6\uFF0C\u6C1B\u56F4\u8F7B\u677E\u6109\u5FEB\uFF0C\u5BF9\u8BDD\u6D3B\u6CFC\u6709\u8DA3\uFF0C\u7B80\u5355\u5FEB\u4E50\uFF0C\u8BA9\u4EBA\u611F\u5230\u8212\u5FC3"
};
var SENTENCE_STYLE_VECTOR_REFERENCES = {
  concise: "\u7B80\u6D01\u53E5\u5F0F\uFF1A\u77ED\u53E5\u591A\uFF0C\u7528\u8BCD\u7CBE\u70BC\uFF0C\u5C11\u4FEE\u9970\uFF0C\u8282\u594F\u660E\u5FEB\uFF0C\u5E72\u8106\u5229\u843D",
  gorgeous: "\u534E\u4E3D\u53E5\u5F0F\uFF1A\u957F\u53E5\u591A\uFF0C\u8F9E\u85FB\u4E30\u5BCC\uFF0C\u4FEE\u9970\u7E41\u590D\uFF0C\u610F\u5883\u4F18\u7F8E\uFF0C\u6587\u91C7\u6590\u7136",
  cold: "\u51B7\u5CFB\u53E5\u5F0F\uFF1A\u53E5\u5B50\u77ED\u4FC3\uFF0C\u7528\u8BCD\u7CBE\u51C6\uFF0C\u7B14\u950B\u7280\u5229\uFF0C\u5BA2\u89C2\u51B7\u9759\uFF0C\u4E0D\u5E26\u611F\u60C5",
  delicate: "\u7EC6\u817B\u53E5\u5F0F\uFF1A\u53E5\u5B50\u8212\u5C55\uFF0C\u7EC6\u8282\u4E30\u5BCC\uFF0C\u63CF\u5199\u6DF1\u5165\uFF0C\u8282\u594F\u8212\u7F13\uFF0C\u5A13\u5A13\u9053\u6765"
};
var PERSPECTIVE_VECTOR_REFERENCES = {
  first_person: '\u7B2C\u4E00\u4EBA\u79F0\uFF1A\u4EE5"\u6211"\u7684\u89C6\u89D2\u53D9\u8FF0\uFF0C\u5185\u5FC3\u72EC\u767D\u591A\uFF0C\u4E3B\u89C2\u611F\u53D7\u5F3A\uFF0C\u8BB2\u8FF0\u81EA\u5DF1\u7684\u6545\u4E8B',
  third_person_omniscient: "\u7B2C\u4E09\u4EBA\u79F0\u5168\u77E5\uFF1A\u4E0A\u5E1D\u89C6\u89D2\uFF0C\u53EF\u5207\u6362\u4E0D\u540C\u4EBA\u7269\uFF0C\u5C55\u73B0\u5168\u5C40\uFF0C\u77E5\u9053\u6240\u6709\u4E8B\u60C5",
  third_person_limited: "\u7B2C\u4E09\u4EBA\u79F0\u9650\u77E5\uFF1A\u8DDF\u968F\u4E3B\u89D2\u89C6\u89D2\uFF0C\u53EA\u80FD\u77E5\u9053\u4E3B\u89D2\u77E5\u9053\u7684\u4E8B\uFF0C\u53D7\u9650\u7684\u53D9\u8FF0\u89D2\u5EA6"
};
var GENRE_VECTOR_REFERENCES = {
  xuanhuan: "\u7384\u5E7B\u9898\u6750\uFF1A\u4FEE\u70BC \u5883\u754C \u529F\u6CD5 \u4E39\u836F \u6CD5\u5B9D \u5996\u517D \u5B97\u95E8 \u6D1E\u5929 \u7075\u529B \u795E\u9B42 \u4FEE\u4ED9 \u4FEE\u771F",
  dushi: "\u90FD\u5E02\u9898\u6750\uFF1A\u804C\u573A \u5546\u6218 \u90FD\u5E02 \u603B\u88C1 \u8C6A\u95E8 \u6295\u8D44 \u521B\u4E1A \u90FD\u5E02\u4E3D\u4EBA \u7CBE\u82F1 \u767D\u9886",
  yanqing: "\u8A00\u60C5\u9898\u6750\uFF1A\u604B\u7231 \u5FC3\u52A8 \u6697\u604B \u9738\u9053\u603B\u88C1 \u751C\u5BA0 \u8650\u604B \u9752\u6885\u7AF9\u9A6C \u65E5\u4E45\u751F\u60C5 \u7231\u60C5",
  lishi: "\u5386\u53F2\u9898\u6750\uFF1A\u671D\u4EE3 \u7687\u5E1D \u5927\u81E3 \u5C06\u519B \u79D1\u4E3E \u6C5F\u6E56 \u671D\u5802 \u6218\u4E89 \u6CBB\u56FD \u53E4\u4EE3",
  kehuan: "\u79D1\u5E7B\u9898\u6750\uFF1A\u661F\u9645 \u673A\u7532 \u57FA\u56E0 \u5B87\u5B99\u98DE\u8239 \u5916\u661F\u4EBA \u4EBA\u5DE5\u667A\u80FD \u672A\u6765\u4E16\u754C \u592A\u7A7A",
  xuanyi: "\u60AC\u7591\u9898\u6750\uFF1A\u63A8\u7406 \u4FA6\u63A2 \u51F6\u624B \u8C1C\u56E2 \u7EBF\u7D22 \u771F\u76F8 \u9634\u8C0B \u60CA\u609A \u72AF\u7F6A \u7834\u6848",
  wuxia: "\u6B66\u4FA0\u9898\u6750\uFF1A\u6C5F\u6E56 \u95E8\u6D3E \u6B66\u529F \u79D8\u7C4D \u4FA0\u58EB \u5251\u5BA2 \u6069\u6028\u60C5\u4EC7 \u6B66\u6797\u76DF\u4E3B \u529F\u592B",
  youxi: "\u6E38\u620F\u9898\u6750\uFF1A\u526F\u672C \u88C5\u5907 \u7B49\u7EA7 \u6280\u80FD \u4EFB\u52A1 NPC \u516C\u4F1A \u73A9\u5BB6 \u901A\u5173 \u6253\u602A"
};
var StyleDeconstructor = class {
  constructor(vectorEnhancer2) {
    this.modalParticleSet = new Set(MODAL_PARTICLES);
    this.verbSet = new Set(VERB_KEYWORDS);
    this.adjectiveSet = new Set(ADJECTIVE_KEYWORDS);
    this.adverbSet = new Set(ADVERB_KEYWORDS);
    this.appearanceSet = new Set(APPEARANCE_KEYWORDS);
    this.environmentSet = new Set(ENVIRONMENT_KEYWORDS);
    this.actionSet = new Set(ACTION_KEYWORDS);
    this.psychologySet = new Set(PSYCHOLOGY_KEYWORDS);
    this.metaphorSet = new Set(METAPHOR_KEYWORDS);
    this.rhetoricalQuestionSet = new Set(RHETORICAL_QUESTION_KEYWORDS);
    this.hyperboleSet = new Set(HYPERBOLE_KEYWORDS);
    this.dialoguePromptSet = new Set(DIALOGUE_PROMPT_WORDS);
    this.timeOpeningSet = new Set(TIME_OPENING_WORDS);
    this.conjunctionOpeningSet = new Set(CONJUNCTION_OPENING_WORDS);
    this.subjectOpeningSet = new Set(SUBJECT_OPENING_WORDS);
    this.colloquialSet = new Set(COLLOQUIAL_WORDS);
    this.vectorEnhancer = vectorEnhancer2;
    this.genreDetector = new GenreDetector();
    this.genreRegistry = GenreConfigRegistry.getInstance();
    this.senseWordMap = /* @__PURE__ */ new Map();
    this.senseMaxWordLen = 1;
    for (const sense of SENSE_TYPES) {
      const words = FIVE_SENSES_WORDS[sense];
      if (!words)
        continue;
      for (const w of words) {
        if (!this.senseWordMap.has(w)) {
          this.senseWordMap.set(w, sense);
        }
        if (w.length > this.senseMaxWordLen) {
          this.senseMaxWordLen = w.length;
        }
      }
    }
  }
  /**
   * 注入 LLM 增强器。注入后 analyze 方法末尾会调用 LLM 做语义提炼。
   * 不注入时 analyze 行为完全不变（纯统计）。
   */
  setLLMEnhancer(llmEnhancer) {
    this.llmEnhancer = llmEnhancer;
  }
  async analyze(text, genreConfig) {
    if (!text || text.length === 0) {
      return this.getEmptyResult();
    }
    const resolvedGenreConfig = genreConfig ?? this.detectGenreConfig(text);
    const paragraphs = this.splitParagraphs(text);
    const totalChars = text.length;
    const sentences = this.splitSentences(text);
    const totalSentences = sentences.length;
    const totalParagraphs = paragraphs.length;
    const sentenceRhythm = this.analyzeSentenceRhythm(text, sentences);
    const wordPreference = this.analyzeWordPreference(text, totalChars);
    await yieldToUI();
    const narrativeStyle = this.analyzeNarrativeStyle(text, paragraphs);
    const rhetoric = this.analyzeRhetoric(text, totalChars);
    await yieldToUI();
    const dialogueStyle = this.analyzeDialogueStyle(text);
    const paragraphStructure = this.analyzeParagraphStructure(paragraphs);
    await yieldToUI();
    const vocabularyRichness = this.analyzeVocabularyRichness(text, totalChars);
    await yieldToUI();
    const fiveSenses = this.analyzeFiveSenses(text, totalChars);
    await yieldToUI();
    const overallStyle = this.classifyOverallStyle(
      sentenceRhythm,
      wordPreference,
      narrativeStyle,
      rhetoric,
      dialogueStyle,
      text,
      resolvedGenreConfig
    );
    const result = {
      sentenceRhythm,
      wordPreference,
      narrativeStyle,
      rhetoric,
      dialogueStyle,
      paragraphStructure,
      overallStyle,
      vocabularyRichness,
      fiveSenses,
      stats: {
        totalChars,
        totalSentences,
        totalParagraphs
      }
    };
    if (this.llmEnhancer) {
      try {
        const contextText = LLMEnhancer.buildContextForDimension("style", text, paragraphs);
        return await this.llmEnhancer.enhanceResult(result, contextText, "style", resolvedGenreConfig);
      } catch (e) {
        log3.warn("[StyleDeconstructor] LLM \u589E\u5F3A\u5931\u8D25\uFF0C\u4F7F\u7528\u7EAF\u7EDF\u8BA1\u7ED3\u679C", e);
        return result;
      }
    }
    return result;
  }
  async analyzeWithVector(text, genreConfig) {
    const baseResult = await this.analyze(text, genreConfig);
    await yieldToUI();
    if (!this.vectorEnhancer || !text || text.length === 0) {
      return baseResult;
    }
    try {
      const available = await this.vectorEnhancer.isAvailable();
      if (!available) {
        log3.warn("[StyleDeconstructor] \u5411\u91CF\u6A21\u578B\u4E0D\u53EF\u7528\uFF0C\u8FD4\u56DE\u7EAF\u7EDF\u8BA1\u7ED3\u679C");
        return baseResult;
      }
    } catch (e) {
      log3.warn("[StyleDeconstructor] \u5411\u91CF\u589E\u5F3A\u4E0D\u53EF\u7528\uFF0C\u964D\u7EA7\u4E3A\u7EAF\u7EDF\u8BA1", e);
      return baseResult;
    }
    let enhancedResult = { ...baseResult };
    try {
      await yieldToUI();
      enhancedResult = await this.enhanceOverallStyle(text, enhancedResult);
    } catch (e) {
      log3.warn("[StyleDeconstructor] \u6574\u4F53\u6587\u98CE\u5411\u91CF\u589E\u5F3A\u5931\u8D25", e);
    }
    try {
      await yieldToUI();
      enhancedResult = await this.enhanceSentenceStyle(text, enhancedResult);
    } catch (e) {
      log3.warn("[StyleDeconstructor] \u53E5\u5F0F\u98CE\u683C\u5411\u91CF\u589E\u5F3A\u5931\u8D25", e);
    }
    try {
      await yieldToUI();
      enhancedResult = await this.enhanceNarrativeStyle(text, enhancedResult);
    } catch (e) {
      log3.warn("[StyleDeconstructor] \u53D9\u4E8B\u98CE\u683C\u5411\u91CF\u589E\u5F3A\u5931\u8D25", e);
    }
    try {
      await yieldToUI();
      enhancedResult = await this.enhanceGenreTendency(text, enhancedResult);
    } catch (e) {
      log3.warn("[StyleDeconstructor] \u9898\u6750\u503E\u5411\u5411\u91CF\u589E\u5F3A\u5931\u8D25", e);
    }
    return enhancedResult;
  }
  async analyzeTwoPhase(text, genreConfig) {
    const ruleBased = await this.analyze(text, genreConfig);
    if (!this.vectorEnhancer || !text || text.length === 0) {
      return {
        ruleBased,
        vectorVerified: ruleBased,
        verificationDetails: {
          dimensionsVerified: [],
          dimensionsAdjusted: [],
          overallConfidenceChange: 0
        }
      };
    }
    let vectorAvailable = false;
    try {
      vectorAvailable = await this.vectorEnhancer.isAvailable();
    } catch {
      vectorAvailable = false;
    }
    if (!vectorAvailable) {
      return {
        ruleBased,
        vectorVerified: ruleBased,
        verificationDetails: {
          dimensionsVerified: [],
          dimensionsAdjusted: [],
          overallConfidenceChange: 0
        }
      };
    }
    let verifiedResult = { ...ruleBased };
    const dimensionsVerified = [];
    const dimensionsAdjusted = [];
    const originalConfidence = ruleBased.overallStyle.confidence;
    try {
      const beforeStyle = verifiedResult.overallStyle.primaryStyle;
      verifiedResult = await this.enhanceOverallStyle(text, verifiedResult);
      const afterStyle = verifiedResult.overallStyle.primaryStyle;
      dimensionsVerified.push("\u6574\u4F53\u6587\u98CE");
      if (beforeStyle !== afterStyle) {
        dimensionsAdjusted.push("\u6574\u4F53\u6587\u98CE");
      }
      verifiedResult.overallStyle.vectorVerified = true;
      verifiedResult.overallStyle.vectorConfidence = verifiedResult.overallStyle.confidence;
    } catch (e) {
      log3.warn("[StyleDeconstructor] \u6574\u4F53\u6587\u98CE\u5411\u91CF\u9A8C\u8BC1\u5931\u8D25", e);
    }
    try {
      const beforeVectorStyle = verifiedResult.sentenceRhythm.dominantVectorStyle;
      verifiedResult = await this.enhanceSentenceStyle(text, verifiedResult);
      const afterVectorStyle = verifiedResult.sentenceRhythm.dominantVectorStyle;
      dimensionsVerified.push("\u53E5\u5F0F\u8282\u594F");
      if (beforeVectorStyle !== afterVectorStyle) {
        dimensionsAdjusted.push("\u53E5\u5F0F\u8282\u594F");
      }
    } catch (e) {
      log3.warn("[StyleDeconstructor] \u53E5\u5F0F\u98CE\u683C\u5411\u91CF\u9A8C\u8BC1\u5931\u8D25", e);
    }
    try {
      const beforePerspective = verifiedResult.narrativeStyle.perspective;
      verifiedResult = await this.enhanceNarrativeStyle(text, verifiedResult);
      const afterPerspective = verifiedResult.narrativeStyle.perspective;
      dimensionsVerified.push("\u53D9\u4E8B\u98CE\u683C");
      if (beforePerspective !== afterPerspective) {
        dimensionsAdjusted.push("\u53D9\u4E8B\u98CE\u683C");
      }
    } catch (e) {
      log3.warn("[StyleDeconstructor] \u53D9\u4E8B\u98CE\u683C\u5411\u91CF\u9A8C\u8BC1\u5931\u8D25", e);
    }
    try {
      const beforeGenres = JSON.stringify(verifiedResult.wordPreference.genreTendency);
      verifiedResult = await this.enhanceGenreTendency(text, verifiedResult);
      const afterGenres = JSON.stringify(verifiedResult.wordPreference.genreTendency);
      dimensionsVerified.push("\u9898\u6750\u503E\u5411");
      if (beforeGenres !== afterGenres) {
        dimensionsAdjusted.push("\u9898\u6750\u503E\u5411");
      }
    } catch (e) {
      log3.warn("[StyleDeconstructor] \u9898\u6750\u503E\u5411\u5411\u91CF\u9A8C\u8BC1\u5931\u8D25", e);
    }
    const newConfidence = verifiedResult.overallStyle.confidence;
    const confidenceChange = newConfidence - originalConfidence;
    return {
      ruleBased,
      vectorVerified: verifiedResult,
      verificationDetails: {
        dimensionsVerified,
        dimensionsAdjusted,
        overallConfidenceChange: this.round2(confidenceChange)
      }
    };
  }
  async enhanceOverallStyle(text, result) {
    if (!this.vectorEnhancer)
      return result;
    const samples = [];
    const sampleLen = 1500;
    if (text.length <= sampleLen * 3) {
      samples.push(text);
    } else {
      samples.push(text.slice(0, sampleLen));
      const midStart = Math.floor(text.length / 2) - Math.floor(sampleLen / 2);
      samples.push(text.slice(midStart, midStart + sampleLen));
      samples.push(text.slice(text.length - sampleLen));
    }
    const styleKeys = Object.keys(STYLE_VECTOR_REFERENCES);
    const styleRefs = styleKeys.map((k) => STYLE_VECTOR_REFERENCES[k]);
    const allTexts = [...samples, ...styleRefs];
    const allVectors = await this.vectorEnhancer.embedTexts(allTexts);
    const sampleVectors = allVectors.slice(0, samples.length);
    const refVectors = allVectors.slice(samples.length);
    const vectorScores = {};
    for (let i = 0; i < styleKeys.length; i++) {
      let totalSim = 0;
      for (const sampleVec of sampleVectors) {
        totalSim += this.vectorEnhancer.cosineSimilarity(sampleVec, refVectors[i]);
      }
      vectorScores[styleKeys[i]] = totalSim / sampleVectors.length;
    }
    const maxVecScore = Math.max(...Object.values(vectorScores));
    const minVecScore = Math.min(...Object.values(vectorScores));
    const vecRange = maxVecScore - minVecScore || 1;
    const normalizedVecScores = {};
    for (const [k, v] of Object.entries(vectorScores)) {
      normalizedVecScores[k] = (v - minVecScore) / vecRange;
    }
    const statScores = result.overallStyle.styleScores;
    const fusedScores = {};
    for (const key of styleKeys) {
      const statScore = statScores[key] || 0;
      const vecScore = normalizedVecScores[key] || 0;
      fusedScores[key] = statScore * 0.4 + vecScore * 0.6;
    }
    const sortedStyles = Object.entries(fusedScores).sort((a, b) => b[1] - a[1]);
    const primaryStyle = sortedStyles[0]?.[0] || "\u672A\u77E5";
    const secondaryStyle = sortedStyles[1]?.[0];
    const totalScore = Object.values(fusedScores).reduce((a, b) => a + b, 0) || 1;
    const confidence = (sortedStyles[0]?.[1] || 0) / totalScore * (styleKeys.length - 1);
    const normalizedFusedScores = {};
    for (const [style, score] of Object.entries(fusedScores)) {
      normalizedFusedScores[style] = this.round2(score);
    }
    return {
      ...result,
      overallStyle: {
        primaryStyle: STYLE_LABELS[primaryStyle] || primaryStyle,
        secondaryStyle: secondaryStyle ? STYLE_LABELS[secondaryStyle] || secondaryStyle : void 0,
        confidence: this.round2(this.clamp01(confidence)),
        styleScores: normalizedFusedScores
      }
    };
  }
  async enhanceSentenceStyle(text, result) {
    if (!this.vectorEnhancer)
      return result;
    const sentences = this.splitSentences(text);
    if (sentences.length === 0)
      return result;
    const shortSentences = sentences.filter((s) => this.countChineseChars(s) <= 10);
    const mediumSentences = sentences.filter((s) => {
      const len = this.countChineseChars(s);
      return len > 10 && len <= 30;
    });
    const longSentences = sentences.filter((s) => this.countChineseChars(s) > 30);
    const sampleSentences = [];
    const targetPerType = 5;
    for (let i = 0; i < Math.min(targetPerType, shortSentences.length); i++) {
      const idx = Math.floor(i * shortSentences.length / Math.min(targetPerType, shortSentences.length));
      sampleSentences.push(shortSentences[idx]);
    }
    for (let i = 0; i < Math.min(targetPerType, mediumSentences.length); i++) {
      const idx = Math.floor(i * mediumSentences.length / Math.min(targetPerType, mediumSentences.length));
      sampleSentences.push(mediumSentences[idx]);
    }
    for (let i = 0; i < Math.min(targetPerType, longSentences.length); i++) {
      const idx = Math.floor(i * longSentences.length / Math.min(targetPerType, longSentences.length));
      sampleSentences.push(longSentences[idx]);
    }
    if (sampleSentences.length === 0)
      return result;
    const sentKeys = Object.keys(SENTENCE_STYLE_VECTOR_REFERENCES);
    const sentRefs = sentKeys.map((k) => SENTENCE_STYLE_VECTOR_REFERENCES[k]);
    const allTexts = [...sampleSentences, ...sentRefs];
    const allVectors = await this.vectorEnhancer.embedTexts(allTexts);
    const sampleVectors = allVectors.slice(0, sampleSentences.length);
    const refVectors = allVectors.slice(sampleSentences.length);
    const sentScores = {};
    for (let i = 0; i < sentKeys.length; i++) {
      let totalSim = 0;
      for (const sampleVec of sampleVectors) {
        totalSim += this.vectorEnhancer.cosineSimilarity(sampleVec, refVectors[i]);
      }
      sentScores[sentKeys[i]] = totalSim / sampleVectors.length;
    }
    const maxSentScore = Math.max(...Object.values(sentScores));
    const dominantSentStyle = Object.entries(sentScores).find(([, v]) => v === maxSentScore)?.[0];
    const enhancedRhythm = { ...result.sentenceRhythm };
    if (dominantSentStyle && sentScores[dominantSentStyle] > 0.5) {
      enhancedRhythm.dominantVectorStyle = dominantSentStyle;
      enhancedRhythm.vectorStyleScores = sentScores;
    }
    return {
      ...result,
      sentenceRhythm: enhancedRhythm
    };
  }
  async enhanceNarrativeStyle(text, result) {
    if (!this.vectorEnhancer)
      return result;
    const paragraphs = this.splitParagraphs(text);
    if (paragraphs.length < 5)
      return result;
    const sampleParagraphs = [];
    const sampleCount = Math.min(10, paragraphs.length);
    for (let i = 0; i < sampleCount; i++) {
      const idx = Math.floor(i * paragraphs.length / sampleCount);
      sampleParagraphs.push(paragraphs[idx]);
    }
    const perspKeys = Object.keys(PERSPECTIVE_VECTOR_REFERENCES);
    const perspRefs = perspKeys.map((k) => PERSPECTIVE_VECTOR_REFERENCES[k]);
    const allTexts = [...sampleParagraphs, ...perspRefs];
    const allVectors = await this.vectorEnhancer.embedTexts(allTexts);
    const sampleVectors = allVectors.slice(0, sampleParagraphs.length);
    const refVectors = allVectors.slice(sampleParagraphs.length);
    const perspScores = {};
    for (let i = 0; i < perspKeys.length; i++) {
      let totalSim = 0;
      for (const sampleVec of sampleVectors) {
        totalSim += this.vectorEnhancer.cosineSimilarity(sampleVec, refVectors[i]);
      }
      perspScores[perspKeys[i]] = totalSim / sampleVectors.length;
    }
    const maxVecScore = Math.max(...Object.values(perspScores));
    const vecPerspective = Object.entries(perspScores).find(([, v]) => v === maxVecScore)?.[0] || "third_person_omniscient";
    const keywordPerspective = result.narrativeStyle.perspective;
    const keywordConfidence = result.narrativeStyle.perspectiveConfidence;
    const vecConfidence = this.clamp01(maxVecScore);
    const fusedConfidence = keywordConfidence * 0.5 + vecConfidence * 0.5;
    let finalPerspective = keywordPerspective;
    if (vecConfidence > keywordConfidence + 0.1) {
      finalPerspective = vecPerspective;
    }
    return {
      ...result,
      narrativeStyle: {
        ...result.narrativeStyle,
        perspective: finalPerspective,
        perspectiveConfidence: this.round2(this.clamp01(fusedConfidence))
      }
    };
  }
  async enhanceGenreTendency(text, result) {
    if (!this.vectorEnhancer)
      return result;
    const top20Words = result.wordPreference.topWords.slice(0, 20);
    if (top20Words.length === 0)
      return result;
    const wordsText = top20Words.map((w) => w.word).join(" ");
    const genreKeys = Object.keys(GENRE_VECTOR_REFERENCES);
    const genreRefs = genreKeys.map((k) => GENRE_VECTOR_REFERENCES[k]);
    const allTexts = [wordsText, ...genreRefs];
    const allVectors = await this.vectorEnhancer.embedTexts(allTexts);
    const wordsVector = allVectors[0];
    const refVectors = allVectors.slice(1);
    const genreScores = [];
    for (let i = 0; i < genreKeys.length; i++) {
      const score = this.vectorEnhancer.cosineSimilarity(wordsVector, refVectors[i]);
      genreScores.push({ genre: genreKeys[i], score: this.round2(score) });
    }
    genreScores.sort((a, b) => b.score - a.score);
    const top3Genres = genreScores.slice(0, 3);
    const genreLabels = {
      xuanhuan: "\u7384\u5E7B",
      dushi: "\u90FD\u5E02",
      yanqing: "\u8A00\u60C5",
      lishi: "\u5386\u53F2",
      kehuan: "\u79D1\u5E7B",
      xuanyi: "\u60AC\u7591",
      wuxia: "\u6B66\u4FA0",
      youxi: "\u6E38\u620F"
    };
    const labeledGenres = top3Genres.map((g) => ({
      genre: genreLabels[g.genre] || g.genre,
      score: g.score
    }));
    return {
      ...result,
      wordPreference: {
        ...result.wordPreference,
        genreTendency: labeledGenres
      }
    };
  }
  async saveAnalysisToMarkdown(app, bookName, result, baseDir) {
    const filePath = kbBookStyleFingerprintFile(bookName, baseDir);
    const frontmatter = this.buildFrontmatter(result);
    const body = this.buildMarkdownBody(result, bookName);
    const content = `---
${frontmatter}
---

${body}`;
    const dirPath = filePath.substring(0, filePath.lastIndexOf("/"));
    if (!await app.vault.adapter.exists(dirPath)) {
      await app.vault.adapter.mkdir(dirPath);
    }
    await app.vault.adapter.write(filePath, content);
  }
  getEmptyResult() {
    return {
      sentenceRhythm: {
        avgSentenceLength: 0,
        medianSentenceLength: 0,
        stdSentenceLength: 0,
        sentenceTypeDistribution: {
          declarative: 0,
          interrogative: 0,
          exclamatory: 0,
          elliptical: 0
        },
        lengthDistribution: {
          short: 0,
          medium: 0,
          long: 0
        }
      },
      wordPreference: {
        topWords: [],
        posPreference: {
          verb: 0,
          adjective: 0,
          adverb: 0
        },
        modalParticles: {
          total: 0,
          perThousand: 0,
          topParticles: []
        },
        idiomDensity: 0,
        colloquialismLevel: 0
      },
      narrativeStyle: {
        perspective: "third_person_omniscient",
        perspectiveConfidence: 0,
        descriptionRatio: {
          appearance: 0,
          environment: 0,
          action: 0,
          psychology: 0,
          total: 0
        },
        narrationRatio: 0,
        dialogueRatio: 0
      },
      rhetoric: {
        metaphor: 0,
        personification: 0,
        parallelism: 0,
        rhetoricalQuestion: 0,
        hyperbole: 0,
        antithesis: 0,
        total: 0,
        perThousand: 0
      },
      dialogueStyle: {
        dialogueRatio: 0,
        promptWordPreference: [],
        avgDialogueLength: 0,
        lengthDistribution: {
          short: 0,
          medium: 0,
          long: 0
        }
      },
      paragraphStructure: {
        avgParagraphLength: 0,
        medianParagraphLength: 0,
        lengthDistribution: {
          short: 0,
          medium: 0,
          long: 0,
          veryLong: 0
        },
        openingFeatures: {
          timeWord: 0,
          conjunction: 0,
          subject: 0,
          other: 0
        }
      },
      overallStyle: {
        primaryStyle: "\u672A\u77E5",
        confidence: 0,
        styleScores: {}
      },
      vocabularyRichness: {
        ttr: 0,
        mtld: 0,
        yulesK: 0,
        hapaxLegomena: 0,
        vocabularySize: 0,
        totalTokens: 0,
        level: "low",
        score: 0
      },
      fiveSenses: {
        distribution: { visual: 0, auditory: 0, olfactory: 0, gustatory: 0, tactile: 0 },
        counts: { visual: 0, auditory: 0, olfactory: 0, gustatory: 0, tactile: 0 },
        perThousand: { visual: 0, auditory: 0, olfactory: 0, gustatory: 0, tactile: 0 },
        dominantSense: "visual",
        balanceScore: 0,
        level: "low",
        details: { visualWords: [], auditoryWords: [], olfactoryWords: [], gustatoryWords: [], tactileWords: [] }
      },
      stats: {
        totalChars: 0,
        totalSentences: 0,
        totalParagraphs: 0
      }
    };
  }
  splitParagraphs(text) {
    return text.split(/\r?\n\r?\n/).map((p) => p.trim()).filter((p) => p.length > 0);
  }
  splitSentences(text) {
    const sentences = [];
    const regex = /[^。！？…!?]+[。！？…!?]+/g;
    let match;
    while ((match = regex.exec(text)) !== null) {
      const s = match[0].trim();
      if (s.length > 0) {
        sentences.push(s);
      }
    }
    if (sentences.length === 0 && text.trim().length > 0) {
      sentences.push(text.trim());
    }
    return sentences;
  }
  analyzeSentenceRhythm(text, sentences) {
    if (sentences.length === 0) {
      return {
        avgSentenceLength: 0,
        medianSentenceLength: 0,
        stdSentenceLength: 0,
        sentenceTypeDistribution: { declarative: 0, interrogative: 0, exclamatory: 0, elliptical: 0 },
        lengthDistribution: { short: 0, medium: 0, long: 0 }
      };
    }
    const lengths = sentences.map((s) => this.countChineseChars(s));
    const avgLength = lengths.reduce((a, b) => a + b, 0) / lengths.length;
    const sortedLengths = [...lengths].sort((a, b) => a - b);
    const medianLength = sortedLengths.length % 2 === 0 ? (sortedLengths[sortedLengths.length / 2 - 1] + sortedLengths[sortedLengths.length / 2]) / 2 : sortedLengths[Math.floor(sortedLengths.length / 2)];
    const variance = lengths.reduce((sum, len) => sum + (len - avgLength) ** 2, 0) / lengths.length;
    const stdLength = Math.sqrt(variance);
    let declarative = 0;
    let interrogative = 0;
    let exclamatory = 0;
    let elliptical = 0;
    for (const s of sentences) {
      const lastChar = s[s.length - 1];
      if (lastChar === "\uFF1F" || lastChar === "?") {
        interrogative++;
      } else if (lastChar === "\uFF01" || lastChar === "!") {
        exclamatory++;
      } else if (lastChar === "\u2026") {
        elliptical++;
      } else {
        declarative++;
      }
    }
    const total = sentences.length;
    let short = 0;
    let medium = 0;
    let long = 0;
    for (const len of lengths) {
      if (len <= 10) {
        short++;
      } else if (len <= 30) {
        medium++;
      } else {
        long++;
      }
    }
    return {
      avgSentenceLength: this.round2(avgLength),
      medianSentenceLength: this.round2(medianLength),
      stdSentenceLength: this.round2(stdLength),
      sentenceTypeDistribution: {
        declarative: this.round2(declarative / total),
        interrogative: this.round2(interrogative / total),
        exclamatory: this.round2(exclamatory / total),
        elliptical: this.round2(elliptical / total)
      },
      lengthDistribution: {
        short: this.round2(short / total),
        medium: this.round2(medium / total),
        long: this.round2(long / total)
      }
    };
  }
  analyzeWordPreference(text, totalChars) {
    const wordFreq = /* @__PURE__ */ new Map();
    for (let len = 2; len <= 4; len++) {
      for (let i = 0; i <= text.length - len; i++) {
        const word = text.slice(i, i + len);
        if (this.isAllChinese(word)) {
          wordFreq.set(word, (wordFreq.get(word) || 0) + 1);
        }
      }
    }
    const topWords = Array.from(wordFreq.entries()).filter(([word]) => word.length >= 2).sort((a, b) => b[1] - a[1]).slice(0, 50).map(([word, count]) => ({
      word,
      count,
      frequency: this.round3(count / Math.max(totalChars, 1))
    }));
    const dedupedTopWords = this.deduplicateTopWords(topWords);
    const verbCount = this.countKeywords(text, this.verbSet);
    const adjCount = this.countKeywords(text, this.adjectiveSet);
    const advCount = this.countKeywords(text, this.adverbSet);
    const posTotal = verbCount + adjCount + advCount || 1;
    const particleCounts = /* @__PURE__ */ new Map();
    let particleTotal = 0;
    for (const p of MODAL_PARTICLES) {
      const count = (text.match(new RegExp(p, "g")) || []).length;
      if (count > 0) {
        particleCounts.set(p, count);
        particleTotal += count;
      }
    }
    const topParticles = Array.from(particleCounts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([word, count]) => ({ word, count }));
    const idiomCount = this.detectIdioms(text);
    let colloquialCount = 0;
    for (const word of COLLOQUIAL_WORDS) {
      colloquialCount += (text.match(new RegExp(word, "g")) || []).length;
    }
    const colloquialismLevel = this.clamp01(colloquialCount / Math.max(totalChars * 0.05, 1));
    return {
      topWords: dedupedTopWords,
      posPreference: {
        verb: this.round2(verbCount / posTotal),
        adjective: this.round2(adjCount / posTotal),
        adverb: this.round2(advCount / posTotal)
      },
      modalParticles: {
        total: particleTotal,
        perThousand: this.round2(particleTotal / Math.max(totalChars, 1) * 1e3),
        topParticles
      },
      idiomDensity: this.round2(idiomCount / Math.max(totalChars, 1) * 1e3),
      colloquialismLevel: this.round2(colloquialismLevel)
    };
  }
  /**
   * topWords 子串去重：
   * - 短词是长词的子串，且短词频次 ≤ 长词频次 × 1.2（短词几乎全部来自长词上下文）时移除短词
   * - 3+ 字长词频次 > 50 时优先保留（启发式识别专有名词，如"紫川秀"）
   * - 保持原排序（按频次降序）
   */
  deduplicateTopWords(topWords) {
    if (topWords.length === 0)
      return topWords;
    const byLenDesc = [...topWords].sort((a, b) => b.word.length - a.word.length);
    const removed = /* @__PURE__ */ new Set();
    for (let i = 0; i < byLenDesc.length; i++) {
      const longer = byLenDesc[i];
      if (removed.has(longer.word))
        continue;
      for (let j = i + 1; j < byLenDesc.length; j++) {
        const shorter = byLenDesc[j];
        if (removed.has(shorter.word))
          continue;
        if (shorter.word.length >= longer.word.length)
          continue;
        if (!longer.word.includes(shorter.word))
          continue;
        const isProperNoun = longer.word.length >= 3 && longer.count > 50;
        const isFreqClose = shorter.count <= longer.count * 1.2;
        if (isProperNoun || isFreqClose) {
          removed.add(shorter.word);
        }
      }
    }
    return topWords.filter((item) => !removed.has(item.word));
  }
  detectIdioms(text) {
    let count = 0;
    const commonWords = /* @__PURE__ */ new Set([
      "\u7684\u662F",
      "\u4E86\u4E00",
      "\u4E00\u4E2A",
      "\u6CA1\u6709",
      "\u4E0D\u662F",
      "\u6211\u4EEC",
      "\u4F60\u4EEC",
      "\u4ED6\u4EEC",
      "\u8FD9\u4E2A",
      "\u90A3\u4E2A",
      "\u4EC0\u4E48",
      "\u600E\u4E48",
      "\u4E3A\u4EC0\u4E48",
      "\u56E0\u4E3A",
      "\u6240\u4EE5",
      "\u4F46\u662F",
      "\u7136\u540E",
      "\u53EF\u4EE5",
      "\u53EF\u80FD",
      "\u5E94\u8BE5",
      "\u81EA\u5DF1",
      "\u4E00\u6837",
      "\u4E00\u4E0B",
      "\u4E00\u76F4",
      "\u5DF2\u7ECF",
      "\u8FD8\u6709",
      "\u5C31\u662F",
      "\u53EA\u662F",
      "\u53EA\u6709",
      "\u8FD8\u6709"
    ]);
    for (let i = 0; i <= text.length - 4; i++) {
      const word = text.slice(i, i + 4);
      if (this.isAllChinese(word) && !commonWords.has(word)) {
        count++;
      }
    }
    return Math.floor(count * 0.1);
  }
  analyzeNarrativeStyle(text, paragraphs) {
    const firstPersonCount = (text.match(/我[们的]/g) || []).length + (text.match(/^我/gm) || []).length;
    const thirdPersonCount = (text.match(/[他她它][们的]/g) || []).length + (text.match(/^[他她它]/gm) || []).length;
    let perspective;
    let perspectiveConfidence;
    const totalPersons = firstPersonCount + thirdPersonCount;
    if (totalPersons === 0) {
      perspective = "third_person_omniscient";
      perspectiveConfidence = 0.3;
    } else {
      const firstRatio = firstPersonCount / totalPersons;
      const thirdRatio = thirdPersonCount / totalPersons;
      if (firstRatio > 0.7) {
        perspective = "first_person";
        perspectiveConfidence = firstRatio;
      } else if (thirdRatio > 0.8) {
        perspective = "third_person_omniscient";
        perspectiveConfidence = thirdRatio;
      } else if (firstRatio > 0.3 && thirdRatio > 0.3) {
        perspective = "mixed";
        perspectiveConfidence = 0.5;
      } else {
        perspective = "third_person_limited";
        perspectiveConfidence = thirdRatio;
      }
    }
    const totalChars = text.length;
    const appearanceCount = this.countKeywords(text, this.appearanceSet);
    const environmentCount = this.countKeywords(text, this.environmentSet);
    const actionCount = this.countKeywords(text, this.actionSet);
    const psychologyCount = this.countKeywords(text, this.psychologySet);
    const dialogueChars = this.calculateDialogueChars(text);
    const dialogueRatio = dialogueChars / Math.max(totalChars, 1);
    const descriptionTotal = appearanceCount + environmentCount + actionCount + psychologyCount;
    const descriptionRatio = Math.min(1, descriptionTotal / Math.max(totalChars * 0.02, 1));
    const narrationRatio = this.clamp01(1 - dialogueRatio - descriptionRatio * 0.3);
    return {
      perspective,
      perspectiveConfidence: this.round2(perspectiveConfidence),
      descriptionRatio: {
        appearance: this.round2(appearanceCount / Math.max(descriptionTotal, 1)),
        environment: this.round2(environmentCount / Math.max(descriptionTotal, 1)),
        action: this.round2(actionCount / Math.max(descriptionTotal, 1)),
        psychology: this.round2(psychologyCount / Math.max(descriptionTotal, 1)),
        total: this.round2(descriptionRatio)
      },
      narrationRatio: this.round2(narrationRatio),
      dialogueRatio: this.round2(dialogueRatio)
    };
  }
  analyzeRhetoric(text, totalChars) {
    const metaphorCount = this.countKeywords(text, this.metaphorSet);
    const rhetoricalQuestionCount = this.countKeywords(text, this.rhetoricalQuestionSet);
    const hyperboleCount = this.countKeywords(text, this.hyperboleSet);
    const personificationCount = this.detectPersonification(text);
    const parallelismCount = this.detectParallelism(text);
    const antithesisCount = this.detectAntithesis(text);
    const total = metaphorCount + personificationCount + parallelismCount + rhetoricalQuestionCount + hyperboleCount + antithesisCount;
    return {
      metaphor: metaphorCount,
      personification: personificationCount,
      parallelism: parallelismCount,
      rhetoricalQuestion: rhetoricalQuestionCount,
      hyperbole: hyperboleCount,
      antithesis: antithesisCount,
      total,
      perThousand: this.round2(total / Math.max(totalChars, 1) * 1e3)
    };
  }
  detectPersonification(text) {
    const nonHumanThings = ["\u98CE", "\u96E8", "\u5C71", "\u6C34", "\u5929", "\u5730", "\u6811", "\u82B1", "\u591C", "\u6708", "\u592A\u9633", "\u661F\u661F"];
    const actionWords = ["\u7B11", "\u54ED", "\u8BF4", "\u5531", "\u8DF3", "\u821E", "\u62E5\u62B1", "\u4EB2\u543B", "\u4F4E\u8BED", "\u53F9\u606F"];
    let count = 0;
    for (const thing of nonHumanThings) {
      for (const action of actionWords) {
        const pattern = `${thing}[^\u3002\uFF01\uFF1F!?]{0,10}${action}`;
        count += (text.match(new RegExp(pattern, "g")) || []).length;
      }
    }
    return count;
  }
  detectParallelism(text) {
    const sentences = this.splitSentences(text);
    let count = 0;
    for (let i = 0; i < sentences.length - 2; i++) {
      const s1 = sentences[i];
      const s2 = sentences[i + 1];
      const s3 = sentences[i + 2];
      const start1 = s1.slice(0, 2);
      const start2 = s2.slice(0, 2);
      const start3 = s3.slice(0, 2);
      if (start1 === start2 && start2 === start3 && this.isChineseChar(start1[0])) {
        count++;
      }
    }
    return count;
  }
  detectAntithesis(text) {
    const sentences = this.splitSentences(text);
    let count = 0;
    for (let i = 0; i < sentences.length - 1; i++) {
      const s1 = sentences[i];
      const s2 = sentences[i + 1];
      const len1 = this.countChineseChars(s1);
      const len2 = this.countChineseChars(s2);
      if (Math.abs(len1 - len2) <= 2 && len1 >= 4 && len2 >= 4) {
        const antonymPairs = [
          ["\u5929", "\u5730"],
          ["\u4E0A", "\u4E0B"],
          ["\u5927", "\u5C0F"],
          ["\u591A", "\u5C11"],
          ["\u957F", "\u77ED"],
          ["\u9AD8", "\u4F4E"],
          ["\u5FEB", "\u6162"],
          ["\u751F", "\u6B7B"]
        ];
        let hasPair = false;
        for (const [a, b] of antonymPairs) {
          if (s1.includes(a) && s2.includes(b)) {
            hasPair = true;
            break;
          }
        }
        if (hasPair)
          count++;
      }
    }
    return count;
  }
  analyzeDialogueStyle(text) {
    const dialogues = this.extractDialogues(text);
    const totalChars = text.length;
    const dialogueChars = dialogues.reduce((sum, d) => sum + d.length, 0);
    const dialogueRatio = dialogueChars / Math.max(totalChars, 1);
    const avgLength = dialogues.length > 0 ? dialogues.reduce((sum, d) => sum + d.length, 0) / dialogues.length : 0;
    let short = 0;
    let medium = 0;
    let long = 0;
    for (const d of dialogues) {
      if (d.length <= 10) {
        short++;
      } else if (d.length <= 30) {
        medium++;
      } else {
        long++;
      }
    }
    const total = dialogues.length || 1;
    const promptCounts = /* @__PURE__ */ new Map();
    for (const word of DIALOGUE_PROMPT_WORDS) {
      const count = (text.match(new RegExp(word + "\u300C|" + word + "\u300E|" + word + '"|' + word + "\u201C", "g")) || []).length;
      if (count > 0) {
        promptCounts.set(word, count);
      }
    }
    const promptWordPreference = Array.from(promptCounts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([word, count]) => ({ word, count }));
    return {
      dialogueRatio: this.round2(dialogueRatio),
      promptWordPreference,
      avgDialogueLength: this.round2(avgLength),
      lengthDistribution: {
        short: this.round2(short / total),
        medium: this.round2(medium / total),
        long: this.round2(long / total)
      }
    };
  }
  extractDialogues(text) {
    const dialogues = [];
    const quotePairs = [
      { start: "\u300C", end: "\u300D" },
      { start: "\u300E", end: "\u300F" },
      { start: '"', end: '"' },
      { start: "'", end: "'" },
      { start: "\u201C", end: "\u201D" },
      { start: "\u2018", end: "\u2019" }
    ];
    for (const pair of quotePairs) {
      let startIdx = 0;
      while (startIdx < text.length) {
        const openIdx = text.indexOf(pair.start, startIdx);
        if (openIdx === -1)
          break;
        const closeIdx = text.indexOf(pair.end, openIdx + 1);
        if (closeIdx === -1)
          break;
        const content = text.slice(openIdx + 1, closeIdx);
        if (content.length > 0) {
          dialogues.push(content);
        }
        startIdx = closeIdx + 1;
      }
    }
    return dialogues;
  }
  calculateDialogueChars(text) {
    return this.extractDialogues(text).reduce((sum, d) => sum + d.length, 0);
  }
  analyzeParagraphStructure(paragraphs) {
    if (paragraphs.length === 0) {
      return {
        avgParagraphLength: 0,
        medianParagraphLength: 0,
        lengthDistribution: { short: 0, medium: 0, long: 0, veryLong: 0 },
        openingFeatures: { timeWord: 0, conjunction: 0, subject: 0, other: 0 }
      };
    }
    const lengths = paragraphs.map((p) => this.countChineseChars(p));
    const avgLength = lengths.reduce((a, b) => a + b, 0) / lengths.length;
    const sortedLengths = [...lengths].sort((a, b) => a - b);
    const medianLength = sortedLengths.length % 2 === 0 ? (sortedLengths[sortedLengths.length / 2 - 1] + sortedLengths[sortedLengths.length / 2]) / 2 : sortedLengths[Math.floor(sortedLengths.length / 2)];
    let short = 0;
    let medium = 0;
    let long = 0;
    let veryLong = 0;
    for (const len of lengths) {
      if (len <= 30) {
        short++;
      } else if (len <= 100) {
        medium++;
      } else if (len <= 300) {
        long++;
      } else {
        veryLong++;
      }
    }
    const total = paragraphs.length;
    let timeWord = 0;
    let conjunction = 0;
    let subject = 0;
    let other = 0;
    for (const para of paragraphs) {
      const trimmed = para.trim();
      if (trimmed.length === 0)
        continue;
      let matched = false;
      for (const word of TIME_OPENING_WORDS) {
        if (trimmed.startsWith(word)) {
          timeWord++;
          matched = true;
          break;
        }
      }
      if (!matched) {
        for (const word of CONJUNCTION_OPENING_WORDS) {
          if (trimmed.startsWith(word)) {
            conjunction++;
            matched = true;
            break;
          }
        }
      }
      if (!matched) {
        for (const word of SUBJECT_OPENING_WORDS) {
          if (trimmed.startsWith(word)) {
            subject++;
            matched = true;
            break;
          }
        }
      }
      if (!matched) {
        other++;
      }
    }
    return {
      avgParagraphLength: this.round2(avgLength),
      medianParagraphLength: this.round2(medianLength),
      lengthDistribution: {
        short: this.round2(short / total),
        medium: this.round2(medium / total),
        long: this.round2(long / total),
        veryLong: this.round2(veryLong / total)
      },
      openingFeatures: {
        timeWord: this.round2(timeWord / total),
        conjunction: this.round2(conjunction / total),
        subject: this.round2(subject / total),
        other: this.round2(other / total)
      }
    };
  }
  tokenize2Gram(text) {
    const tokens = [];
    for (let i = 0; i < text.length - 1; i++) {
      const token = text.slice(i, i + 2);
      if (this.isAllChinese(token)) {
        tokens.push(token);
      }
    }
    return tokens;
  }
  analyzeVocabularyRichness(text, totalChars) {
    const allParas = text.split(/\n\n+/);
    const sampledParas = [];
    for (let pi = 0; pi < allParas.length; pi += 3) {
      sampledParas.push(allParas[pi]);
    }
    const sample = sampledParas.join("\n\n");
    if (sample.length < 2) {
      return this.getEmptyVocabularyRichness();
    }
    const tokens = this.tokenize2Gram(sample);
    if (tokens.length === 0) {
      return this.getEmptyVocabularyRichness();
    }
    const ttr = this.calculateTTRSegmented(sample, 1e3);
    const mtld = this.calculateMTLD(tokens, 0.72);
    const yulesK = this.calculateYulesK(tokens);
    const freq = /* @__PURE__ */ new Map();
    for (const t of tokens) {
      freq.set(t, (freq.get(t) || 0) + 1);
    }
    let hapaxCount = 0;
    for (const c of freq.values()) {
      if (c === 1)
        hapaxCount++;
    }
    const hapax = hapaxCount / tokens.length;
    const vocabularySize = freq.size;
    let level;
    if (ttr > 0.7 && mtld > 50) {
      level = "high";
    } else if (ttr < 0.4 || mtld < 30) {
      level = "low";
    } else {
      level = "medium";
    }
    const ttrNorm = this.clamp01(ttr) * 100;
    const mtldNorm = Math.min(mtld, 100);
    const yulesKNorm = Math.max(0, Math.min(100, 100 - yulesK / 2));
    const hapaxNorm = this.clamp01(hapax) * 100;
    const score = this.clamp01((0.3 * ttrNorm + 0.3 * mtldNorm + 0.2 * yulesKNorm + 0.2 * hapaxNorm) / 100) * 100;
    return {
      ttr: this.round2(ttr),
      mtld: this.round2(mtld),
      yulesK: this.round2(yulesK),
      hapaxLegomena: this.round2(hapax),
      vocabularySize,
      totalTokens: tokens.length,
      level,
      score: this.round2(score)
    };
  }
  getEmptyVocabularyRichness() {
    return {
      ttr: 0,
      mtld: 0,
      yulesK: 0,
      hapaxLegomena: 0,
      vocabularySize: 0,
      totalTokens: 0,
      level: "low",
      score: 0
    };
  }
  calculateTTRSegmented(text, windowSize) {
    if (text.length <= windowSize) {
      const tokens = this.tokenize2Gram(text);
      if (tokens.length === 0)
        return 0;
      const types = new Set(tokens);
      return types.size / tokens.length;
    }
    let totalTTR = 0;
    let segmentCount = 0;
    for (let i = 0; i < text.length; i += windowSize) {
      const segment = text.slice(i, i + windowSize);
      if (segment.length < 2)
        continue;
      const tokens = this.tokenize2Gram(segment);
      if (tokens.length === 0)
        continue;
      const types = new Set(tokens);
      totalTTR += types.size / tokens.length;
      segmentCount++;
    }
    return segmentCount > 0 ? totalTTR / segmentCount : 0;
  }
  calculateMTLD(tokens, threshold) {
    if (tokens.length === 0)
      return 0;
    const forward = this.calculateMTLDDirection(tokens, threshold);
    const reversed = this.calculateMTLDDirection([...tokens].reverse(), threshold);
    return (forward + reversed) / 2;
  }
  calculateMTLDDirection(tokens, threshold) {
    if (tokens.length === 0)
      return 0;
    let factors = 0;
    let tokenCount = 0;
    let types = /* @__PURE__ */ new Set();
    let lastTTR = 1;
    for (const token of tokens) {
      types.add(token);
      tokenCount++;
      const ttr = types.size / tokenCount;
      lastTTR = ttr;
      if (ttr < threshold) {
        factors++;
        types = /* @__PURE__ */ new Set();
        tokenCount = 0;
        lastTTR = 1;
      }
    }
    let partialFactor = 0;
    if (tokenCount > 0 && lastTTR < 1) {
      partialFactor = (1 - lastTTR) / (1 - threshold);
    }
    const totalFactors = factors + partialFactor;
    if (totalFactors <= 0) {
      return tokens.length;
    }
    return tokens.length / totalFactors;
  }
  calculateYulesK(tokens) {
    if (tokens.length === 0)
      return 0;
    const freq = /* @__PURE__ */ new Map();
    for (const t of tokens) {
      freq.set(t, (freq.get(t) || 0) + 1);
    }
    const freqDist = /* @__PURE__ */ new Map();
    for (const c of freq.values()) {
      freqDist.set(c, (freqDist.get(c) || 0) + 1);
    }
    const N = tokens.length;
    let M2 = 0;
    for (const [i, fi] of freqDist.entries()) {
      M2 += i * i * fi;
    }
    return 1e4 * (M2 - N) / (N * N);
  }
  analyzeFiveSenses(text, totalChars) {
    const empty = {
      distribution: { visual: 0, auditory: 0, olfactory: 0, gustatory: 0, tactile: 0 },
      counts: { visual: 0, auditory: 0, olfactory: 0, gustatory: 0, tactile: 0 },
      perThousand: { visual: 0, auditory: 0, olfactory: 0, gustatory: 0, tactile: 0 },
      dominantSense: "visual",
      balanceScore: 0,
      level: "low",
      details: { visualWords: [], auditoryWords: [], olfactoryWords: [], gustatoryWords: [], tactileWords: [] }
    };
    if (!text || text.length === 0)
      return empty;
    const allParas = text.split(/\n\n+/);
    const sampledParas = [];
    for (let pi = 0; pi < allParas.length; pi += 3) {
      sampledParas.push(allParas[pi]);
    }
    const sample = sampledParas.join("\n\n");
    const counts = { visual: 0, auditory: 0, olfactory: 0, gustatory: 0, tactile: 0 };
    const matchedWords = {
      visual: /* @__PURE__ */ new Set(),
      auditory: /* @__PURE__ */ new Set(),
      olfactory: /* @__PURE__ */ new Set(),
      gustatory: /* @__PURE__ */ new Set(),
      tactile: /* @__PURE__ */ new Set()
    };
    for (let i = 0; i < sample.length; i++) {
      for (let len = this.senseMaxWordLen; len >= 1; len--) {
        if (i + len > sample.length)
          continue;
        const sub = sample.slice(i, i + len);
        const sense = this.senseWordMap.get(sub);
        if (sense) {
          counts[sense]++;
          matchedWords[sense].add(sub);
          break;
        }
      }
    }
    const totalSenseCount = SENSE_TYPES.reduce((sum, s) => sum + counts[s], 0);
    const distribution = { visual: 0, auditory: 0, olfactory: 0, gustatory: 0, tactile: 0 };
    if (totalSenseCount > 0) {
      for (const s of SENSE_TYPES) {
        distribution[s] = counts[s] / totalSenseCount;
      }
    }
    const perThousand = { visual: 0, auditory: 0, olfactory: 0, gustatory: 0, tactile: 0 };
    for (const s of SENSE_TYPES) {
      perThousand[s] = counts[s] / Math.max(totalChars, 1) * 1e3;
    }
    let dominantSense = "visual";
    let maxCount = -1;
    for (const s of SENSE_TYPES) {
      if (counts[s] > maxCount) {
        maxCount = counts[s];
        dominantSense = s;
      }
    }
    let entropy = 0;
    for (const s of SENSE_TYPES) {
      if (distribution[s] > 0) {
        entropy -= distribution[s] * Math.log2(distribution[s]);
      }
    }
    const maxEntropy = Math.log2(SENSE_TYPES.length);
    const balanceScore = maxEntropy > 0 ? entropy / maxEntropy * 100 : 0;
    const totalPerThousand = SENSE_TYPES.reduce((sum, s) => sum + perThousand[s], 0);
    let level;
    if (totalPerThousand > 10) {
      level = "high";
    } else if (totalPerThousand >= 3) {
      level = "medium";
    } else {
      level = "low";
    }
    const sampleWordLimit = 20;
    const roundedDistribution = { visual: 0, auditory: 0, olfactory: 0, gustatory: 0, tactile: 0 };
    const roundedPerThousand = { visual: 0, auditory: 0, olfactory: 0, gustatory: 0, tactile: 0 };
    for (const s of SENSE_TYPES) {
      roundedDistribution[s] = this.round2(distribution[s]);
      roundedPerThousand[s] = this.round2(perThousand[s]);
    }
    return {
      distribution: roundedDistribution,
      counts,
      perThousand: roundedPerThousand,
      dominantSense,
      balanceScore: this.round2(balanceScore),
      level,
      details: {
        visualWords: Array.from(matchedWords.visual).slice(0, sampleWordLimit),
        auditoryWords: Array.from(matchedWords.auditory).slice(0, sampleWordLimit),
        olfactoryWords: Array.from(matchedWords.olfactory).slice(0, sampleWordLimit),
        gustatoryWords: Array.from(matchedWords.gustatory).slice(0, sampleWordLimit),
        tactileWords: Array.from(matchedWords.tactile).slice(0, sampleWordLimit)
      }
    };
  }
  classifyOverallStyle(sentenceRhythm, wordPreference, narrativeStyle, rhetoric, dialogueStyle, text, genreConfig) {
    if (genreConfig && genreConfig.styleKeywords && genreConfig.styleKeywords.length > 0) {
      const keywordHits = [];
      for (const keyword of genreConfig.styleKeywords) {
        if (!keyword)
          continue;
        const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const count = (text.match(new RegExp(escaped, "g")) || []).length;
        if (count > 0) {
          keywordHits.push({ keyword, count });
        }
      }
      if (keywordHits.length > 0) {
        keywordHits.sort((a, b) => b.count - a.count);
        const totalHits = keywordHits.reduce((sum, h) => sum + h.count, 0);
        const primaryStyle2 = keywordHits[0].keyword;
        const secondaryStyle2 = keywordHits[1]?.keyword;
        const confidence2 = this.round2(this.clamp01(keywordHits[0].count / totalHits));
        const styleScores = {};
        for (const hit of keywordHits) {
          styleScores[hit.keyword] = this.round2(hit.count / totalHits);
        }
        return {
          primaryStyle: primaryStyle2,
          secondaryStyle: secondaryStyle2,
          confidence: confidence2,
          styleScores
        };
      }
    }
    const scores = {};
    const shortSentenceRatio = sentenceRhythm.lengthDistribution.short;
    const longSentenceRatio = sentenceRhythm.lengthDistribution.long;
    const adjRatio = wordPreference.posPreference.adjective;
    const descRatio = narrativeStyle.descriptionRatio.total;
    const psychRatio = narrativeStyle.descriptionRatio.psychology;
    const actionRatio = narrativeStyle.descriptionRatio.action;
    const exclamatoryRatio = sentenceRhythm.sentenceTypeDistribution.exclamatory;
    const dialogueRatio = dialogueStyle.dialogueRatio;
    const particleLevel = wordPreference.modalParticles.perThousand / 20;
    const colloquialLevel = wordPreference.colloquialismLevel;
    const rhetoricDensity = rhetoric.perThousand / 5;
    const idiomDensity = wordPreference.idiomDensity / 5;
    scores.concise = shortSentenceRatio * 0.4 + (1 - adjRatio) * 0.3 + (1 - descRatio) * 0.3;
    scores.gorgeous = longSentenceRatio * 0.25 + adjRatio * 0.25 + rhetoricDensity * 0.25 + idiomDensity * 0.25;
    scores.cold = shortSentenceRatio * 0.3 + (1 - adjRatio) * 0.2 + (1 - rhetoric.metaphor / Math.max(rhetoric.total, 1)) * 0.2 + (1 - dialogueRatio) * 0.3;
    scores.delicate = longSentenceRatio * 0.25 + descRatio * 0.35 + psychRatio * 0.25 + adjRatio * 0.15;
    scores.passionate = actionRatio * 0.3 + shortSentenceRatio * 0.2 + exclamatoryRatio * 0.2 + dialogueRatio * 0.15 + rhetoricDensity * 0.15;
    scores.humorous = particleLevel * 0.3 + dialogueRatio * 0.25 + colloquialLevel * 0.25 + rhetoricDensity * 0.2;
    scores.heavy = longSentenceRatio * 0.25 + descRatio * 0.25 + psychRatio * 0.25 + (1 - exclamatoryRatio) * 0.25;
    scores.relaxed = shortSentenceRatio * 0.25 + particleLevel * 0.25 + dialogueRatio * 0.25 + colloquialLevel * 0.25;
    let maxScore = 0;
    let secondMaxScore = 0;
    let primaryStyle = "\u672A\u77E5";
    let secondaryStyle;
    for (const [style, score] of Object.entries(scores)) {
      if (score > maxScore) {
        secondMaxScore = maxScore;
        maxScore = score;
        secondaryStyle = primaryStyle;
        primaryStyle = style;
      } else if (score > secondMaxScore) {
        secondMaxScore = score;
        secondaryStyle = style;
      }
    }
    const totalScore = Object.values(scores).reduce((a, b) => a + b, 0) || 1;
    const confidence = maxScore / totalScore * (Object.keys(scores).length - 1);
    const normalizedScores = {};
    for (const [style, score] of Object.entries(scores)) {
      normalizedScores[style] = this.round2(score);
    }
    return {
      primaryStyle: STYLE_LABELS[primaryStyle] || primaryStyle,
      secondaryStyle: secondaryStyle ? STYLE_LABELS[secondaryStyle] || secondaryStyle : void 0,
      confidence: this.round2(this.clamp01(confidence)),
      styleScores: normalizedScores
    };
  }
  /**
   * 自动检测文本题材并加载对应 GenreConfig。
   * 检测失败或异常时回退到 generic 配置，保证不抛异常。
   */
  detectGenreConfig(text) {
    try {
      const detection = this.genreDetector.detect(text);
      return this.genreRegistry.getGenreConfig(detection.genreId);
    } catch {
      try {
        return this.genreRegistry.getGenreConfig("generic");
      } catch {
        return {
          genreId: "generic",
          displayName: "\u901A\u7528",
          behaviorTraits: [],
          abilityKeywords: [],
          techniqueKeywords: [],
          foreshadowTypes: [],
          conflictKeywords: [],
          showSignalWords: [],
          styleKeywords: [],
          detectorSignals: []
        };
      }
    }
  }
  countKeywords(text, keywordSet) {
    let count = 0;
    for (const word of keywordSet) {
      count += (text.match(new RegExp(word, "g")) || []).length;
    }
    return count;
  }
  countChineseChars(text) {
    let count = 0;
    for (let i = 0; i < text.length; i++) {
      if (this.isChineseChar(text[i])) {
        count++;
      }
    }
    return count;
  }
  isAllChinese(text) {
    for (let i = 0; i < text.length; i++) {
      if (!this.isChineseChar(text[i])) {
        return false;
      }
    }
    return text.length > 0;
  }
  isChineseChar(char) {
    const code = char.charCodeAt(0);
    return code >= 19968 && code <= 40959;
  }
  buildFrontmatter(result) {
    const data = {
      overallStyle: {
        primaryStyle: result.overallStyle.primaryStyle,
        secondaryStyle: result.overallStyle.secondaryStyle,
        confidence: result.overallStyle.confidence
      },
      sentenceRhythm: result.sentenceRhythm,
      wordPreference: {
        topWords: result.wordPreference.topWords.slice(0, 20),
        posPreference: result.wordPreference.posPreference,
        modalParticles: result.wordPreference.modalParticles,
        idiomDensity: result.wordPreference.idiomDensity,
        colloquialismLevel: result.wordPreference.colloquialismLevel
      },
      narrativeStyle: result.narrativeStyle,
      rhetoric: result.rhetoric,
      dialogueStyle: result.dialogueStyle,
      paragraphStructure: result.paragraphStructure,
      vocabularyRichness: result.vocabularyRichness,
      fiveSenses: result.fiveSenses,
      stats: result.stats
    };
    return JSON.stringify(data, null, 2);
  }
  buildMarkdownBody(result, bookName) {
    const lines = [];
    lines.push(`# ${bookName} - \u6587\u98CE\u98CE\u683C\u5206\u6790\u62A5\u544A`);
    lines.push("");
    lines.push("## \u7EDF\u8BA1\u6982\u89C8");
    lines.push("");
    lines.push(`- \u603B\u5B57\u7B26\u6570\uFF1A**${result.stats.totalChars}**`);
    lines.push(`- \u603B\u53E5\u5B50\u6570\uFF1A**${result.stats.totalSentences}**`);
    lines.push(`- \u603B\u6BB5\u843D\u6570\uFF1A**${result.stats.totalParagraphs}**`);
    lines.push("");
    lines.push("## \u6574\u4F53\u6587\u98CE");
    lines.push("");
    lines.push(`- \u4E3B\u8981\u6587\u98CE\uFF1A**${result.overallStyle.primaryStyle}**`);
    if (result.overallStyle.secondaryStyle) {
      lines.push(`- \u6B21\u8981\u6587\u98CE\uFF1A${result.overallStyle.secondaryStyle}`);
    }
    lines.push(`- \u7F6E\u4FE1\u5EA6\uFF1A**${(result.overallStyle.confidence * 100).toFixed(0)}%**`);
    lines.push("");
    lines.push("### \u5404\u6587\u98CE\u5F97\u5206");
    lines.push("");
    lines.push("| \u6587\u98CE\u7C7B\u578B | \u5F97\u5206 |");
    lines.push("|----------|------|");
    const sortedStyles = Object.entries(result.overallStyle.styleScores).sort((a, b) => b[1] - a[1]);
    for (const [style, score] of sortedStyles) {
      lines.push(`| ${STYLE_LABELS[style] || style} | ${score.toFixed(2)} |`);
    }
    lines.push("");
    lines.push("## \u53E5\u5F0F\u8282\u594F");
    lines.push("");
    lines.push(`- \u5E73\u5747\u53E5\u957F\uFF1A**${result.sentenceRhythm.avgSentenceLength}** \u5B57`);
    lines.push(`- \u4E2D\u4F4D\u6570\u53E5\u957F\uFF1A${result.sentenceRhythm.medianSentenceLength} \u5B57`);
    lines.push(`- \u6807\u51C6\u5DEE\uFF1A${result.sentenceRhythm.stdSentenceLength}`);
    lines.push("");
    lines.push("### \u53E5\u578B\u5206\u5E03");
    lines.push("");
    lines.push("| \u53E5\u578B | \u6BD4\u4F8B |");
    lines.push("|------|------|");
    lines.push(`| \u9648\u8FF0\u53E5 | ${(result.sentenceRhythm.sentenceTypeDistribution.declarative * 100).toFixed(1)}% |`);
    lines.push(`| \u7591\u95EE\u53E5 | ${(result.sentenceRhythm.sentenceTypeDistribution.interrogative * 100).toFixed(1)}% |`);
    lines.push(`| \u611F\u53F9\u53E5 | ${(result.sentenceRhythm.sentenceTypeDistribution.exclamatory * 100).toFixed(1)}% |`);
    lines.push(`| \u7701\u7565\u53E5 | ${(result.sentenceRhythm.sentenceTypeDistribution.elliptical * 100).toFixed(1)}% |`);
    lines.push("");
    lines.push("### \u957F\u77ED\u53E5\u5206\u5E03");
    lines.push("");
    lines.push("| \u7C7B\u578B | \u6BD4\u4F8B |");
    lines.push("|------|------|");
    lines.push(`| \u77ED\u53E5 (\u226410\u5B57) | ${(result.sentenceRhythm.lengthDistribution.short * 100).toFixed(1)}% |`);
    lines.push(`| \u4E2D\u53E5 (11-30\u5B57) | ${(result.sentenceRhythm.lengthDistribution.medium * 100).toFixed(1)}% |`);
    lines.push(`| \u957F\u53E5 (>30\u5B57) | ${(result.sentenceRhythm.lengthDistribution.long * 100).toFixed(1)}% |`);
    lines.push("");
    lines.push("## \u7528\u8BCD\u504F\u597D");
    lines.push("");
    lines.push("### \u8BCD\u6027\u504F\u597D");
    lines.push("");
    lines.push("| \u8BCD\u6027 | \u504F\u597D\u6307\u6570 |");
    lines.push("|------|----------|");
    lines.push(`| \u52A8\u8BCD | ${result.wordPreference.posPreference.verb.toFixed(2)} |`);
    lines.push(`| \u5F62\u5BB9\u8BCD | ${result.wordPreference.posPreference.adjective.toFixed(2)} |`);
    lines.push(`| \u526F\u8BCD | ${result.wordPreference.posPreference.adverb.toFixed(2)} |`);
    lines.push("");
    lines.push("### \u8BED\u6C14\u8BCD\u7EDF\u8BA1");
    lines.push("");
    lines.push(`- \u603B\u6B21\u6570\uFF1A**${result.wordPreference.modalParticles.total}**`);
    lines.push(`- \u6BCF\u5343\u5B57\u6B21\u6570\uFF1A${result.wordPreference.modalParticles.perThousand}`);
    if (result.wordPreference.modalParticles.topParticles.length > 0) {
      lines.push("");
      lines.push("### \u5E38\u7528\u8BED\u6C14\u8BCD");
      lines.push("");
      lines.push("| \u6392\u540D | \u8BED\u6C14\u8BCD | \u6B21\u6570 |");
      lines.push("|------|--------|------|");
      result.wordPreference.modalParticles.topParticles.forEach((p, idx) => {
        lines.push(`| ${idx + 1} | ${p.word} | ${p.count} |`);
      });
    }
    lines.push("");
    lines.push(`- \u6210\u8BED\u5BC6\u5EA6\uFF1A**${result.wordPreference.idiomDensity}** /\u5343\u5B57`);
    lines.push(`- \u53E3\u8BED\u5316\u7A0B\u5EA6\uFF1A**${(result.wordPreference.colloquialismLevel * 100).toFixed(0)}%**`);
    lines.push("");
    if (result.wordPreference.topWords.length > 0) {
      lines.push("### \u9AD8\u9891\u8BCD TOP20");
      lines.push("");
      lines.push("| \u6392\u540D | \u8BCD\u8BED | \u51FA\u73B0\u6B21\u6570 | \u9891\u7387 |");
      lines.push("|------|------|----------|------|");
      result.wordPreference.topWords.slice(0, 20).forEach((w, idx) => {
        lines.push(`| ${idx + 1} | ${w.word} | ${w.count} | ${(w.frequency * 100).toFixed(2)}% |`);
      });
      lines.push("");
    }
    lines.push("## \u53D9\u4E8B\u7279\u70B9");
    lines.push("");
    const perspectiveLabels = {
      first_person: "\u7B2C\u4E00\u4EBA\u79F0",
      third_person_omniscient: "\u7B2C\u4E09\u4EBA\u79F0\u5168\u77E5",
      third_person_limited: "\u7B2C\u4E09\u4EBA\u79F0\u6709\u9650",
      mixed: "\u6DF7\u5408\u89C6\u89D2"
    };
    lines.push(`- \u53D9\u4E8B\u89C6\u89D2\uFF1A**${perspectiveLabels[result.narrativeStyle.perspective] || result.narrativeStyle.perspective}**`);
    lines.push(`- \u89C6\u89D2\u7F6E\u4FE1\u5EA6\uFF1A${(result.narrativeStyle.perspectiveConfidence * 100).toFixed(0)}%`);
    lines.push(`- \u53D9\u8FF0\u5360\u6BD4\uFF1A${(result.narrativeStyle.narrationRatio * 100).toFixed(1)}%`);
    lines.push(`- \u5BF9\u8BDD\u5360\u6BD4\uFF1A${(result.narrativeStyle.dialogueRatio * 100).toFixed(1)}%`);
    lines.push(`- \u603B\u63CF\u5199\u5360\u6BD4\uFF1A**${(result.narrativeStyle.descriptionRatio.total * 100).toFixed(1)}%**`);
    lines.push("");
    lines.push("### \u63CF\u5199\u7C7B\u578B\u5206\u5E03");
    lines.push("");
    lines.push("| \u63CF\u5199\u7C7B\u578B | \u5360\u6BD4 |");
    lines.push("|----------|------|");
    lines.push(`| \u5916\u8C8C\u63CF\u5199 | ${(result.narrativeStyle.descriptionRatio.appearance * 100).toFixed(1)}% |`);
    lines.push(`| \u73AF\u5883\u63CF\u5199 | ${(result.narrativeStyle.descriptionRatio.environment * 100).toFixed(1)}% |`);
    lines.push(`| \u52A8\u4F5C\u63CF\u5199 | ${(result.narrativeStyle.descriptionRatio.action * 100).toFixed(1)}% |`);
    lines.push(`| \u5FC3\u7406\u63CF\u5199 | ${(result.narrativeStyle.descriptionRatio.psychology * 100).toFixed(1)}% |`);
    lines.push("");
    lines.push("## \u4FEE\u8F9E\u624B\u6CD5");
    lines.push("");
    lines.push(`- \u603B\u4FEE\u8F9E\u6B21\u6570\uFF1A**${result.rhetoric.total}**`);
    lines.push(`- \u6BCF\u5343\u5B57\u6B21\u6570\uFF1A${result.rhetoric.perThousand}`);
    lines.push("");
    lines.push("| \u4FEE\u8F9E\u7C7B\u578B | \u6B21\u6570 |");
    lines.push("|----------|------|");
    lines.push(`| \u6BD4\u55BB | ${result.rhetoric.metaphor} |`);
    lines.push(`| \u62DF\u4EBA | ${result.rhetoric.personification} |`);
    lines.push(`| \u6392\u6BD4 | ${result.rhetoric.parallelism} |`);
    lines.push(`| \u53CD\u95EE | ${result.rhetoric.rhetoricalQuestion} |`);
    lines.push(`| \u5938\u5F20 | ${result.rhetoric.hyperbole} |`);
    lines.push(`| \u5BF9\u5076 | ${result.rhetoric.antithesis} |`);
    lines.push("");
    lines.push("## \u5BF9\u8BDD\u98CE\u683C");
    lines.push("");
    lines.push(`- \u5BF9\u8BDD\u5360\u6BD4\uFF1A**${(result.dialogueStyle.dialogueRatio * 100).toFixed(1)}%**`);
    lines.push(`- \u5E73\u5747\u5BF9\u8BDD\u957F\u5EA6\uFF1A${result.dialogueStyle.avgDialogueLength} \u5B57`);
    lines.push("");
    lines.push("### \u5BF9\u8BDD\u957F\u5EA6\u5206\u5E03");
    lines.push("");
    lines.push("| \u7C7B\u578B | \u6BD4\u4F8B |");
    lines.push("|------|------|");
    lines.push(`| \u77ED\u5BF9\u8BDD (\u226410\u5B57) | ${(result.dialogueStyle.lengthDistribution.short * 100).toFixed(1)}% |`);
    lines.push(`| \u4E2D\u5BF9\u8BDD (11-30\u5B57) | ${(result.dialogueStyle.lengthDistribution.medium * 100).toFixed(1)}% |`);
    lines.push(`| \u957F\u5BF9\u8BDD (>30\u5B57) | ${(result.dialogueStyle.lengthDistribution.long * 100).toFixed(1)}% |`);
    lines.push("");
    if (result.dialogueStyle.promptWordPreference.length > 0) {
      lines.push("### \u63D0\u793A\u8BCD\u504F\u597D TOP10");
      lines.push("");
      lines.push("| \u6392\u540D | \u63D0\u793A\u8BCD | \u6B21\u6570 |");
      lines.push("|------|--------|------|");
      result.dialogueStyle.promptWordPreference.forEach((p, idx) => {
        lines.push(`| ${idx + 1} | ${p.word} | ${p.count} |`);
      });
      lines.push("");
    }
    lines.push("## \u6BB5\u843D\u7ED3\u6784");
    lines.push("");
    lines.push(`- \u5E73\u5747\u6BB5\u957F\uFF1A**${result.paragraphStructure.avgParagraphLength}** \u5B57`);
    lines.push(`- \u4E2D\u4F4D\u6570\u6BB5\u957F\uFF1A${result.paragraphStructure.medianParagraphLength} \u5B57`);
    lines.push("");
    lines.push("### \u6BB5\u957F\u5206\u5E03");
    lines.push("");
    lines.push("| \u7C7B\u578B | \u6BD4\u4F8B |");
    lines.push("|------|------|");
    lines.push(`| \u77ED\u6BB5 (\u226430\u5B57) | ${(result.paragraphStructure.lengthDistribution.short * 100).toFixed(1)}% |`);
    lines.push(`| \u4E2D\u6BB5 (31-100\u5B57) | ${(result.paragraphStructure.lengthDistribution.medium * 100).toFixed(1)}% |`);
    lines.push(`| \u957F\u6BB5 (101-300\u5B57) | ${(result.paragraphStructure.lengthDistribution.long * 100).toFixed(1)}% |`);
    lines.push(`| \u8D85\u957F\u6BB5 (>300\u5B57) | ${(result.paragraphStructure.lengthDistribution.veryLong * 100).toFixed(1)}% |`);
    lines.push("");
    lines.push("### \u6BB5\u843D\u5F00\u5934\u7279\u5F81");
    lines.push("");
    lines.push("| \u7279\u5F81\u7C7B\u578B | \u6BD4\u4F8B |");
    lines.push("|----------|------|");
    lines.push(`| \u65F6\u95F4\u8BCD\u5F00\u5934 | ${(result.paragraphStructure.openingFeatures.timeWord * 100).toFixed(1)}% |`);
    lines.push(`| \u8FDE\u63A5\u8BCD\u5F00\u5934 | ${(result.paragraphStructure.openingFeatures.conjunction * 100).toFixed(1)}% |`);
    lines.push(`| \u4E3B\u8BED\u5F00\u5934 | ${(result.paragraphStructure.openingFeatures.subject * 100).toFixed(1)}% |`);
    lines.push(`| \u5176\u4ED6\u5F00\u5934 | ${(result.paragraphStructure.openingFeatures.other * 100).toFixed(1)}% |`);
    lines.push("");
    if (result.vocabularyRichness) {
      const vr = result.vocabularyRichness;
      lines.push("## \u8BCD\u6C47\u4E30\u5BCC\u5EA6");
      lines.push("");
      lines.push(`- TTR\uFF08\u7C7B\u578Btoken\u6BD4\uFF09\uFF1A**${vr.ttr}**`);
      lines.push(`- MTLD\uFF08\u8BCD\u6C47\u591A\u6837\u6027\u5EA6\u91CF\uFF09\uFF1A${vr.mtld}`);
      lines.push(`- Yule's K \u5E38\u6570\uFF1A${vr.yulesK}`);
      lines.push(`- Hapax Legomena\uFF08\u53EA\u51FA\u73B0\u4E00\u6B21\u7684\u8BCD\u6BD4\u4F8B\uFF09\uFF1A${(vr.hapaxLegomena * 100).toFixed(1)}%`);
      lines.push(`- \u72EC\u7ACB\u8BCD\u6570\uFF1A${vr.vocabularySize}`);
      lines.push(`- \u603B\u8BCD\u6570\uFF1A${vr.totalTokens}`);
      lines.push(`- \u4E30\u5BCC\u5EA6\u7B49\u7EA7\uFF1A**${VR_LEVEL_LABELS[vr.level]}**`);
      lines.push(`- \u7EFC\u5408\u8BC4\u5206\uFF1A**${vr.score}** / 100`);
      lines.push("");
    }
    if (result.fiveSenses) {
      const fs = result.fiveSenses;
      lines.push("## \u4E94\u611F\u5206\u6790");
      lines.push("");
      lines.push("### \u4E94\u611F\u5206\u5E03");
      lines.push("");
      lines.push("| \u611F\u5B98 | \u6B21\u6570 | \u5360\u6BD4 | \u6BCF\u5343\u5B57 |");
      lines.push("|------|------|------|--------|");
      for (const s of SENSE_TYPES) {
        lines.push(`| ${SENSE_LABELS[s]} | ${fs.counts[s]} | ${(fs.distribution[s] * 100).toFixed(1)}% | ${fs.perThousand[s].toFixed(2)} |`);
      }
      lines.push("");
      lines.push(`- \u4E3B\u5BFC\u611F\u5B98\uFF1A**${SENSE_LABELS[fs.dominantSense]}**`);
      lines.push(`- \u5E73\u8861\u5EA6\uFF1A**${fs.balanceScore}** / 100`);
      lines.push(`- \u63CF\u5199\u5BC6\u5EA6\u7B49\u7EA7\uFF1A**${VR_LEVEL_LABELS[fs.level]}**`);
      lines.push("");
      lines.push("### \u5404\u611F\u5B98\u8BCD\u6837\u672C");
      lines.push("");
      lines.push(`- \u89C6\u89C9\u8BCD\uFF1A${fs.details.visualWords.join("\u3001") || "\u65E0"}`);
      lines.push(`- \u542C\u89C9\u8BCD\uFF1A${fs.details.auditoryWords.join("\u3001") || "\u65E0"}`);
      lines.push(`- \u55C5\u89C9\u8BCD\uFF1A${fs.details.olfactoryWords.join("\u3001") || "\u65E0"}`);
      lines.push(`- \u5473\u89C9\u8BCD\uFF1A${fs.details.gustatoryWords.join("\u3001") || "\u65E0"}`);
      lines.push(`- \u89E6\u89C9\u8BCD\uFF1A${fs.details.tactileWords.join("\u3001") || "\u65E0"}`);
      lines.push("");
    }
    return lines.join("\n");
  }
  clamp01(v) {
    return Math.max(0, Math.min(1, v));
  }
  round2(n) {
    return Math.round(n * 100) / 100;
  }
  /**
   * 保留 3 位小数。用于 topWords.frequency 等需要更高精度的统计，
   * 避免 725/100000=0.00725 被压成 0.01 或 0。
   */
  round3(n) {
    return Math.round(n * 1e3) / 1e3;
  }
};

// engine/style/style-deconstructor-v2.ts
var POSITIVE_EMOTION_WORDS = [
  "\u5F00\u5FC3",
  "\u5FEB\u4E50",
  "\u9AD8\u5174",
  "\u559C\u60A6",
  "\u6B22\u559C",
  "\u6B23\u559C",
  "\u6B23\u6170",
  "\u6EE1\u610F",
  "\u5E78\u798F",
  "\u751C\u871C",
  "\u6FC0\u52A8",
  "\u5174\u594B",
  "\u632F\u594B",
  "\u96C0\u8DC3",
  "\u6B22\u6B23",
  "\u6109\u60A6",
  "\u8212\u7545",
  "\u7545\u5FEB",
  "\u75DB\u5FEB",
  "\u8212\u5FC3",
  "\u5B89\u5FC3",
  "\u653E\u5FC3",
  "\u8E0F\u5B9E",
  "\u5B81\u9759",
  "\u5E73\u9759",
  "\u5B89\u8BE6",
  "\u7965\u548C",
  "\u6E29\u99A8",
  "\u6E29\u6696",
  "\u67D4\u548C",
  "\u5E0C\u671B",
  "\u671F\u5F85",
  "\u5411\u5F80",
  "\u61A7\u61AC",
  "\u6E34\u671B",
  "\u70ED\u7231",
  "\u949F\u7231",
  "\u559C\u7231",
  "\u559C\u6B22",
  "\u949F\u610F",
  "\u611F\u6FC0",
  "\u611F\u6069",
  "\u611F\u52A8",
  "\u611F\u8C22",
  "\u8C22\u610F",
  "\u656C\u4F69",
  "\u656C\u4EF0",
  "\u5C0A\u656C",
  "\u5D07\u62DC",
  "\u4EF0\u6155",
  "\u9A84\u50B2",
  "\u81EA\u8C6A",
  "\u8363\u8000",
  "\u5149\u8363",
  "\u8F89\u714C",
  "\u80DC\u5229",
  "\u6210\u529F",
  "\u6210\u5C31",
  "\u6536\u83B7",
  "\u6EE1\u8DB3",
  "\u7F8E\u4E3D",
  "\u7F8E\u597D",
  "\u5B8C\u7F8E",
  "\u7CBE\u5F69",
  "\u51FA\u8272",
  "\u4F18\u79C0",
  "\u5353\u8D8A",
  "\u6770\u51FA",
  "\u975E\u51E1",
  "\u975E\u51E1",
  "\u707F\u70C2",
  "\u8F89\u714C",
  "\u5149\u660E",
  "\u660E\u4EAE",
  "\u660E\u6717",
  "\u6674\u6717",
  "\u660E\u5A9A",
  "\u7EDA\u70C2",
  "\u7EDA\u4E3D",
  "\u7470\u4E3D"
];
var NEGATIVE_EMOTION_WORDS = [
  "\u60B2\u4F24",
  "\u4F24\u5FC3",
  "\u96BE\u8FC7",
  "\u75DB\u82E6",
  "\u60B2\u75DB",
  "\u54C0\u4F24",
  "\u54C0\u6101",
  "\u54C0\u75DB",
  "\u60B2\u6078",
  "\u60B2\u5207",
  "\u54ED\u6CE3",
  "\u6D41\u6CEA",
  "\u843D\u6CEA",
  "\u555C\u6CE3",
  "\u62BD\u564E",
  "\u54FD\u54BD",
  "\u545C\u54BD",
  "\u54C0\u53F7",
  "\u60B2\u9E23",
  "\u60B2\u6CE3",
  "\u6124\u6012",
  "\u751F\u6C14",
  "\u607C\u6012",
  "\u607C\u706B",
  "\u6124\u6068",
  "\u6124\u6168",
  "\u6124\u61D1",
  "\u6124\u6124",
  "\u6012\u706B",
  "\u6012\u6C14",
  "\u66B4\u6012",
  "\u72C2\u6012",
  "\u9707\u6012",
  "\u6012\u543C",
  "\u6012\u65A5",
  "\u6012\u89C6",
  "\u6012\u76EE",
  "\u6012\u51B2\u51B2",
  "\u6C14\u51B2\u51B2",
  "\u6012\u53D1\u51B2\u51A0",
  "\u6050\u60E7",
  "\u5BB3\u6015",
  "\u754F\u60E7",
  "\u60E7\u6015",
  "\u60CA\u6050",
  "\u60F6\u6050",
  "\u60CA\u614C",
  "\u614C\u5F20",
  "\u614C\u4E71",
  "\u60CA\u614C\u5931\u63AA",
  "\u7126\u8651",
  "\u7126\u6025",
  "\u7126\u8E81",
  "\u70E6\u8E81",
  "\u6025\u8E81",
  "\u4E0D\u5B89",
  "\u5FD0\u5FD1",
  "\u5FE7\u8651",
  "\u5FE7\u6101",
  "\u5FE7\u6101",
  "\u7EDD\u671B",
  "\u5931\u671B",
  "\u6CAE\u4E27",
  "\u9893\u4E27",
  "\u9893\u5E9F",
  "\u6D88\u6C89",
  "\u4F4E\u843D",
  "\u5931\u843D",
  "\u7A7A\u865A",
  "\u5B64\u72EC",
  "\u5BC2\u5BDE",
  "\u51C4\u51C9",
  "\u51C4\u60E8",
  "\u60B2\u60E8",
  "\u51C4\u51B7",
  "\u51C4\u6E05",
  "\u51C4\u5BC2",
  "\u60B2\u51C9",
  "\u82CD\u51C9",
  "\u8352\u51C9"
];
var HIGH_INTENSITY_EMOTION_WORDS = [
  "\u72C2\u559C",
  "\u66B4\u6012",
  "\u72C2\u6012",
  "\u9707\u6012",
  "\u60CA\u6050",
  "\u7EDD\u671B",
  "\u60B2\u75DB",
  "\u60B2\u6078",
  "\u54C0\u53F7",
  "\u6012\u543C",
  "\u5D29\u6E83",
  "\u5D29\u6E83",
  "\u75AF\u72C2",
  "\u766B\u72C2",
  "\u75F4\u72C2",
  "\u6FC0\u6124",
  "\u4EA2\u594B",
  "\u6F8E\u6E43",
  "\u6C79\u6D8C",
  "\u6F8E\u6E43"
];
var MEDIUM_INTENSITY_EMOTION_WORDS = [
  "\u6FC0\u52A8",
  "\u5174\u594B",
  "\u6124\u6012",
  "\u6050\u60E7",
  "\u7126\u8651",
  "\u5FE7\u4F24",
  "\u60B2\u4F24",
  "\u6124\u6012",
  "\u751F\u6C14",
  "\u9AD8\u5174",
  "\u5931\u671B",
  "\u6CAE\u4E27",
  "\u5FD0\u5FD1",
  "\u4E0D\u5B89",
  "\u7126\u6025",
  "\u671F\u5F85",
  "\u6E34\u671B",
  "\u70ED\u7231",
  "\u618E\u6068",
  "\u538C\u6076"
];
var SUSPENSE_WORDS = [
  "\u7A81\u7136",
  "\u5FFD\u7136",
  "\u731B\u7136",
  "\u9AA4\u7136",
  "\u9661\u7136",
  "\u77AC\u95F4",
  "\u970E\u65F6",
  "\u5239\u90A3",
  "\u9877\u523B",
  "\u987F\u7136",
  "\u7136\u800C",
  "\u4F46\u662F",
  "\u53EF\u662F",
  "\u4E0D\u8FC7",
  "\u53EA\u662F",
  "\u5012\u662F",
  "\u5374",
  "\u4F46",
  "\u53EF",
  "\u53EA\u662F",
  "\u7ADF\u7136",
  "\u5C45\u7136",
  "\u679C\u4E0D\u5176\u7136",
  "\u679C\u771F",
  "\u679C\u7136",
  "\u4E0D\u51FA\u6240\u6599",
  "\u60F3\u4E0D\u5230",
  "\u6CA1\u60F3\u5230",
  "\u5C82\u6599",
  "\u8C01\u77E5",
  "\u8C1C",
  "\u8C1C\u56E2",
  "\u8C1C\u5E95",
  "\u79D8\u5BC6",
  "\u9690\u79D8",
  "\u9690\u60C5",
  "\u9690\u60C5",
  "\u7384\u673A",
  "\u8E4A\u8DF7",
  "\u53E4\u602A",
  "\u8BE1\u5F02",
  "\u53EF\u7591",
  "\u5947\u602A",
  "\u79BB\u5947",
  "\u5947\u7279",
  "\u5F02\u5E38",
  "\u53CD\u5E38",
  "\u4E0D\u5BF9\u52B2",
  "\u4E0D\u5BF9",
  "\u8E4A\u8DF7"
];
var CONFLICT_WORDS = [
  "\u51B2\u7A81",
  "\u5BF9\u6297",
  "\u4E89\u6267",
  "\u4E89\u5435",
  "\u5435\u95F9",
  "\u5435\u67B6",
  "\u6253\u6597",
  "\u6218\u6597",
  "\u640F\u6597",
  "\u53AE\u6740",
  "\u653B\u51FB",
  "\u8FDB\u653B",
  "\u53CD\u51FB",
  "\u56DE\u51FB",
  "\u8FD8\u51FB",
  "\u62B5\u6297",
  "\u53CD\u6297",
  "\u5BF9\u6297",
  "\u5BF9\u7ACB",
  "\u654C\u5BF9",
  "\u654C\u89C6",
  "\u4EC7\u89C6",
  "\u4EC7\u6068",
  "\u6028\u6068",
  "\u6000\u6068",
  "\u8BB0\u6068",
  "\u75DB\u6068",
  "\u618E\u6068",
  "\u538C\u6076",
  "\u8BA8\u538C",
  "\u6012\u9A82",
  "\u6012\u65A5",
  "\u8BAD\u65A5",
  "\u65A5\u8D23",
  "\u8D23\u9A82",
  "\u8D23\u5907",
  "\u8D23\u602A",
  "\u57CB\u6028",
  "\u62B1\u6028",
  "\u8BC9\u82E6",
  "\u53CD\u5BF9",
  "\u62D2\u7EDD",
  "\u5426\u51B3",
  "\u9A73\u56DE",
  "\u63A8\u7FFB",
  "\u5426\u5B9A",
  "\u9A73\u56DE",
  "\u6297\u62D2",
  "\u8FDD\u6297",
  "\u8FDD\u80CC"
];
var TURNING_POINT_WORDS = [
  "\u4F46\u662F",
  "\u7136\u800C",
  "\u53EF\u662F",
  "\u4E0D\u8FC7",
  "\u5374",
  "\u5012\u662F",
  "\u53EA\u662F",
  "\u7136\u800C",
  "\u53CD\u4E4B",
  "\u76F8\u53CD",
  "\u51FA\u4E4E\u610F\u6599",
  "\u610F\u60F3\u4E0D\u5230",
  "\u59CB\u6599\u672A\u53CA",
  "\u51FA\u4E4E\u610F\u6599",
  "\u7ADF\u7136",
  "\u5C45\u7136",
  "\u54EA\u77E5",
  "\u54EA\u6599",
  "\u8C01\u77E5",
  "\u5C82\u6599"
];
var FORESHADOWING_MARKERS = [
  "...",
  "\u2026\u2026",
  "\uFF08\u6CE8\uFF1A",
  "(\u6CE8:",
  "\u3010\u6CE8\u3011",
  "\u203B",
  "\u2020",
  "\u4F0F\u7B14",
  "\u6697\u793A",
  "\u9884\u793A"
];
var VISUAL_WORDS = [
  "\u770B",
  "\u89C1",
  "\u671B",
  "\u77A7",
  "\u77A5",
  "\u76EF",
  "\u51DD\u89C6",
  "\u6CE8\u89C6",
  "\u89C2\u5BDF",
  "\u6253\u91CF",
  "\u989C\u8272",
  "\u8272\u5F69",
  "\u5149",
  "\u4EAE",
  "\u6697",
  "\u660E",
  "\u9ED1",
  "\u767D",
  "\u7EA2",
  "\u84DD",
  "\u7EFF",
  "\u9EC4",
  "\u7D2B",
  "\u91D1",
  "\u94F6",
  "\u5F62\u72B6",
  "\u5927\u5C0F",
  "\u9AD8\u4F4E",
  "\u7C97\u7EC6",
  "\u957F\u77ED",
  "\u7F8E\u4E3D",
  "\u6F02\u4EAE",
  "\u82F1\u4FCA",
  "\u4E11\u964B",
  "\u6E05\u79C0",
  "\u4FCA\u6717",
  "\u79C0\u4E3D",
  "\u660E\u4E3D",
  "\u8273\u4E3D",
  "\u7EDA\u4E3D"
];
var AUDITORY_WORDS = [
  "\u542C",
  "\u95FB",
  "\u8046\u542C",
  "\u503E\u542C",
  "\u4FA7\u8033",
  "\u7AD6\u8033",
  "\u542C\u89C1",
  "\u542C\u5230",
  "\u58F0\u54CD",
  "\u58F0\u97F3",
  "\u54CD",
  "\u9E23",
  "\u53EB",
  "\u558A",
  "\u543C",
  "\u5486\u54EE",
  "\u5636\u543C",
  "\u4F4E\u8BED",
  "\u5462\u5583",
  "\u5583\u5583",
  "\u97F3\u4E50",
  "\u6B4C\u58F0",
  "\u66F2\u8C03",
  "\u65CB\u5F8B",
  "\u8282\u594F",
  "\u5608\u6742",
  "\u55A7\u95F9",
  "\u5BC2\u9759",
  "\u5B89\u9759",
  "\u5B81\u9759",
  "\u53EE\u5F53",
  "\u53EE\u549A",
  "\u54D7\u5566",
  "\u8F70\u9686",
  "\u7830",
  "\u556A",
  "\u55D2",
  "\u53EE",
  "\u549A",
  "\u94DB"
];
var TACTILE_WORDS = [
  "\u6478",
  "\u89E6",
  "\u78B0",
  "\u629A\u6478",
  "\u89E6\u78B0",
  "\u89E6\u6478",
  "\u63A5\u89E6",
  "\u611F\u53D7",
  "\u611F\u89C9\u5230",
  "\u89E6\u611F",
  "\u51B7",
  "\u70ED",
  "\u6E29",
  "\u51C9",
  "\u51B0",
  "\u70EB",
  "\u6696",
  "\u5BD2",
  "\u51BB",
  "\u71E5",
  "\u8F6F",
  "\u786C",
  "\u6ED1",
  "\u6DA9",
  "\u7C97",
  "\u7EC6",
  "\u817B",
  "\u7CD9",
  "\u97E7",
  "\u8106",
  "\u75DB",
  "\u75BC",
  "\u9178",
  "\u9EBB",
  "\u75D2",
  "\u80C0",
  "\u7D27",
  "\u677E",
  "\u91CD",
  "\u8F7B"
];
var OLFACTORY_WORDS = [
  "\u95FB",
  "\u55C5",
  "\u55C5\u5230",
  "\u95FB\u5230",
  "\u6C14\u5473",
  "\u5473\u9053",
  "\u9999\u5473",
  "\u9999\u6C14",
  "\u82AC\u82B3",
  "\u82B3\u9999",
  "\u8165",
  "\u8165\u5473",
  "\u8165\u6C14",
  "\u8165\u81ED",
  "\u81ED",
  "\u81ED\u5473",
  "\u6076\u81ED",
  "\u8150\u81ED",
  "\u9178\u81ED",
  "\u8165\u81BB",
  "\u9999",
  "\u99A8",
  "\u99A5\u90C1",
  "\u6E05\u9999",
  "\u5E7D\u9999",
  "\u6697\u9999",
  "\u4F59\u9999",
  "\u6A80\u9999",
  "\u6A80\u9999",
  "\u711A\u9999"
];
var GUSTATORY_WORDS = [
  "\u5C1D",
  "\u54C1\u5C1D",
  "\u54C1",
  "\u5C1D\u5230",
  "\u5403\u5230",
  "\u5473\u9053",
  "\u6ECB\u5473",
  "\u53E3\u5473",
  "\u53E3\u611F",
  "\u5473\u513F",
  "\u751C",
  "\u9178",
  "\u82E6",
  "\u8FA3",
  "\u54B8",
  "\u6DE1",
  "\u9C9C",
  "\u6DA9",
  "\u9EBB",
  "\u6E05",
  "\u7518",
  "\u7518\u751C",
  "\u7518\u9187",
  "\u9187\u539A",
  "\u9187\u9999",
  "\u7F8E\u5473",
  "\u53EF\u53E3",
  "\u597D\u5403",
  "\u96BE\u5403",
  "\u6076\u5FC3"
];
var PROPER_NOUN_MARKERS = [
  "\u5B97",
  "\u95E8",
  "\u6D3E",
  "\u9601",
  "\u697C",
  "\u5BAB",
  "\u6BBF",
  "\u9662",
  "\u5802",
  "\u5E84",
  "\u56FD",
  "\u57CE",
  "\u9547",
  "\u6751",
  "\u5C71",
  "\u6CB3",
  "\u6D77",
  "\u6E56",
  "\u8C37",
  "\u6797",
  "\u5C9B",
  "\u6D32",
  "\u5173",
  "\u5CE1",
  "\u539F",
  "\u6F20",
  "\u6C99",
  "\u96EA",
  "\u51B0",
  "\u706B"
];
var SETTING_INJECTION_WORDS = [
  "\u6240\u8C13",
  "\u636E\u8BF4",
  "\u4F20\u8BF4",
  "\u76F8\u4F20",
  "\u636E\u8BF4",
  "\u636E\u8BF4",
  "\u636E\u8BF4",
  "\u539F\u662F",
  "\u672C\u662F",
  "\u4E43\u662F",
  "\u6307\u7684\u662F",
  "\u610F\u601D\u662F",
  "\u4EE3\u8868\u7740",
  "\u8C61\u5F81\u7740",
  "\u5BD3\u610F",
  "\u542B\u4E49",
  "\u672C\u8D28",
  "\u771F\u76F8",
  "\u5B9E\u8D28",
  "\u5185\u6DB5",
  "\u5B9A\u4E49",
  "\u89C4\u5219",
  "\u6CD5\u5219",
  "\u89C4\u5F8B",
  "\u539F\u7406",
  "\u5B9A\u5F8B",
  "\u5B9A\u7406",
  "\u516C\u5F0F",
  "\u673A\u5236",
  "\u4F53\u7CFB"
];
var ARCHAISM_WORDS = [
  "\u4E4B",
  "\u5176",
  "\u6240",
  "\u8005",
  "\u4E5F",
  "\u77E3",
  "\u7109",
  "\u54C9",
  "\u4E4E",
  "\u516E",
  "\u5C14",
  "\u8033",
  "\u592B",
  "\u76D6",
  "\u6545",
  "\u4E14",
  "\u82E5",
  "\u867D",
  "\u5219",
  "\u8BDA",
  "\u4E43",
  "\u5373",
  "\u5EB6",
  "\u8FFA",
  "\u7230",
  "\u6538",
  "\u9050",
  "\u9088",
  "\u60A0",
  "\u6773",
  "\u66F0",
  "\u8C13",
  "\u4E91",
  "\u9053",
  "\u8A00",
  "\u8BED",
  "\u8BC9",
  "\u9648",
  "\u8FF0",
  "\u544A",
  "\u543E",
  "\u4F59",
  "\u4E88",
  "\u6715",
  "\u5BE1\u4EBA",
  "\u5B64",
  "\u54C0\u5BB6",
  "\u672C\u5BAB",
  "\u81E3",
  "\u59BE",
  "\u6C5D",
  "\u5C14",
  "\u4E43",
  "\u5C0A",
  "\u4EE4",
  "\u8D24",
  "\u8D35",
  "\u9AD8",
  "\u5B9D",
  "\u96C5"
];
var REGIONAL_WORDS = [
  "\u4FFA",
  "\u54B1",
  "\u989D",
  "\u6492",
  "\u54C8",
  "\u561B",
  "\u54A7",
  "\u54E9",
  "\u54DF",
  "\u55D2",
  "\u548B",
  "\u5565",
  "\u548B\u4E2A",
  "\u548B\u6837",
  "\u548B\u529E",
  "\u548B\u8BF4",
  "\u548B\u6574",
  "\u548B\u5F04",
  "\u548B\u641E",
  "\u548B\u60F3",
  "\u5F04\u5565",
  "\u641E\u5565",
  "\u505A\u5565",
  "\u5E72\u5565",
  "\u5F04\u5565\u5B50",
  "\u641E\u5565\u5B50",
  "\u505A\u5565\u5B50",
  "\u5E72\u5565\u5B50",
  "\u5F04\u5565\u54A7",
  "\u641E\u5565\u54A7",
  "\u6653\u5F97",
  "\u6653\u5F97\u4F10",
  "\u6653\u5F97\u5427",
  "\u6653\u5F97\u5566",
  "\u6653\u5F97\u54AF",
  "\u6653\u5F97\u561E",
  "\u6653\u5F97\u55BD",
  "\u6653\u5F97\u5570",
  "\u6653\u5F97\u561B",
  "\u6653\u5F97\u54C8"
];
var FUNCTION_WORDS = [
  "\u7684",
  "\u4E86",
  "\u662F",
  "\u5728",
  "\u6709",
  "\u548C",
  "\u5C31",
  "\u4E0D",
  "\u4EBA",
  "\u4E00",
  "\u4E0A",
  "\u4E5F",
  "\u5F88",
  "\u5230",
  "\u8BF4",
  "\u8981",
  "\u53BB",
  "\u4F1A",
  "\u7740",
  "\u6CA1",
  "\u770B",
  "\u597D",
  "\u81EA\u5DF1",
  "\u8FD9",
  "\u90A3",
  "\u4F60",
  "\u4ED6",
  "\u5979",
  "\u5B83",
  "\u4EEC",
  "\u4E2A",
  "\u628A",
  "\u8BA9",
  "\u88AB",
  "\u4ECE",
  "\u5411",
  "\u5F80",
  "\u5BF9",
  "\u4E3A",
  "\u4EE5",
  "\u4E4B",
  "\u5176",
  "\u6240",
  "\u8005",
  "\u4E5F",
  "\u77E3",
  "\u7109",
  "\u54C9",
  "\u4E4E",
  "\u516E"
];
var COMMON_WORDS = [
  "\u7684",
  "\u4E86",
  "\u662F",
  "\u5728",
  "\u6709",
  "\u548C",
  "\u5C31",
  "\u4E0D",
  "\u4EBA",
  "\u4E00",
  "\u4E0A",
  "\u4E5F",
  "\u5F88",
  "\u5230",
  "\u8BF4",
  "\u8981",
  "\u53BB",
  "\u4F1A",
  "\u7740",
  "\u6CA1",
  "\u770B",
  "\u597D",
  "\u81EA\u5DF1",
  "\u8FD9",
  "\u90A3",
  "\u4F60",
  "\u4ED6",
  "\u5979",
  "\u5B83",
  "\u4EEC",
  "\u4EC0\u4E48",
  "\u600E\u4E48",
  "\u4E3A\u4EC0\u4E48",
  "\u56E0\u4E3A",
  "\u6240\u4EE5",
  "\u4F46\u662F",
  "\u7136\u540E",
  "\u53EF\u4EE5",
  "\u53EF\u80FD",
  "\u5E94\u8BE5",
  "\u73B0\u5728",
  "\u4ECA\u5929",
  "\u660E\u5929",
  "\u6628\u5929",
  "\u4EE5\u540E",
  "\u4EE5\u524D",
  "\u5DF2\u7ECF",
  "\u6B63\u5728",
  "\u9A6C\u4E0A",
  "\u7ACB\u523B"
];
var RHETORICAL_QUESTION_MARKERS = [
  "\u96BE\u9053",
  "\u5C82",
  "\u4F55\u4E0D",
  "\u4F55\u5C1D",
  "\u5C82\u975E",
  "\u96BE\u9053\u8BF4",
  "\u5C82\u4E0D\u662F",
  "\u4E0D\u662F\u5417",
  "\u5BF9\u4E0D\u5BF9",
  "\u662F\u5417",
  "\u5C82\u4E0D\u662F\u5417",
  "\u96BE\u9053\u4E0D\u662F",
  "\u5C82\u80FD",
  "\u5C82\u4F1A",
  "\u5C82\u53EF",
  "\u600E\u4F1A",
  "\u600E\u80FD",
  "\u600E\u53EF",
  "\u600E\u6562",
  "\u600E\u80AF"
];
var INVERSION_PATTERNS = [
  /[^，。！？]{1,8}的[^，。！？]{1,8}了[。！？]/g,
  /[^，。！？]{1,8}地[^，。！？]{1,8}了[。！？]/g,
  /[^，。！？]{1,8}得[^，。！？]{1,8}了[。！？]/g,
  /太[^，。！？]{1,6}了/g,
  /多[^，。！？]{1,6}啊/g
];
var TIME_JUMP_WORDS = [
  "\u4E09\u5E74\u540E",
  "\u4E94\u5E74\u540E",
  "\u5341\u5E74\u540E",
  "\u6570\u5E74\u540E",
  "\u591A\u5E74\u540E",
  "\u51E0\u65E5\u540E",
  "\u6570\u65E5\u540E",
  "\u7FCC\u65E5",
  "\u6B21\u65E5",
  "\u7B2C\u4E8C\u5929",
  "\u7B2C\u4E09\u5929",
  "\u4E00\u5468\u540E",
  "\u4E00\u4E2A\u6708\u540E",
  "\u6570\u6708\u540E",
  "\u534A\u5E74\u540E",
  "\u4E00\u5E74\u540E",
  "\u6570\u5E74\u540E",
  "\u8BB8\u4E45\u540E",
  "\u4E09\u5E74\u524D",
  "\u4E94\u5E74\u524D",
  "\u5341\u5E74\u524D",
  "\u6570\u5E74\u524D",
  "\u591A\u5E74\u524D",
  "\u51E0\u5929\u524D",
  "\u6570\u65E5\u524D",
  "\u524D\u4E00\u5929",
  "\u524D\u65E5",
  "\u6B64\u65F6",
  "\u5F7C\u65F6",
  "\u6B64\u523B",
  "\u5F7C\u523B",
  "\u5F53\u4E0B",
  "\u5F53\u65F6",
  "\u90A3\u65F6",
  "\u8FD9\u65F6",
  "\u90A3\u65E5",
  "\u4ECA\u65E5"
];
var SCENE_SWITCH_WORDS = [
  "\u4E0E\u6B64\u540C\u65F6",
  "\u53E6\u4E00\u8FB9",
  "\u53E6\u4E00\u5904",
  "\u53E6\u4E00\u5730",
  "\u5374\u8BF4",
  "\u4E14\u8BF4",
  "\u8BDD\u5206\u4E24\u5934",
  "\u6309\u4E0B\u4E0D\u8868",
  "\u4E14\u6309\u4E0B",
  "\u56DE\u8FC7\u5934\u6765",
  "\u76EE\u5149\u8F6C\u5411",
  "\u89C6\u7EBF\u79FB\u5230",
  "\u955C\u5934\u4E00\u8F6C",
  "\u8BDD\u8BF4",
  "\u518D\u8BF4",
  "\u518D\u8BF4",
  "\u56DE\u5934\u8BF4",
  "\u518D\u8BF4\u90A3",
  "\u5374\u8BF4\u90A3",
  "\u8BDD\u8BF4\u90A3"
];
var NARRATIVE_NEAR_WORDS = [
  "\u6211",
  "\u5FC3\u60F3",
  "\u6697\u60F3",
  "\u6697\u9053",
  "\u89C9\u5F97",
  "\u611F\u5230",
  "\u611F\u89C9",
  "\u60F3\u5230",
  "\u8BA4\u4E3A",
  "\u5FC3\u9053",
  "\u5FC3\u5934",
  "\u5FC3\u4E2D",
  "\u5185\u5FC3",
  "\u5FC3\u5E95",
  "\u5FC3\u4E0B",
  "\u5FC3\u91CC",
  "\u8111\u6D77\u4E2D",
  "\u8111\u5B50\u91CC",
  "\u610F\u8BC6",
  "\u76F4\u89C9"
];
var NARRATIVE_FAR_WORDS = [
  "\u636E\u8BF4",
  "\u76F8\u4F20",
  "\u4F20\u95FB",
  "\u636E\u8BF4",
  "\u636E\u8BF4",
  "\u636E\u8BB0\u8F7D",
  "\u636E\u8BB0\u8F7D",
  "\u636E\u4F20",
  "\u636E\u4F20",
  "\u636E\u8BF4",
  "\u4F17\u4EBA\u7686\u77E5",
  "\u4F17\u6240\u5468\u77E5",
  "\u4EBA\u4EBA\u7686\u77E5",
  "\u5929\u4E0B\u7686\u77E5",
  "\u4F17\u6240\u5468\u77E5",
  "\u4F17\u6240\u5468\u77E5",
  "\u636E\u8BF4",
  "\u636E\u8BF4",
  "\u636E\u8BF4",
  "\u636E\u8BF4"
];
var StyleDeconstructorV2 = class {
  constructor(vectorEnhancer2) {
    // 性能缓存：同一次 analyze 中 text 不变，避免重复遍历
    this._cachedText = "";
    this._cachedChineseCharCount = -1;
    this._cachedSentenceCharCounts = /* @__PURE__ */ new Map();
    /** 多字词合并正则缓存（按词表 Set 缓存，避免重复构建） */
    this._regexCache = /* @__PURE__ */ new Map();
    // 跨词表合并优化：一次正则匹配统计所有词表
    this._allKeywordSets = [];
    this._allMultiCharRegex = null;
    this._wordToSets = /* @__PURE__ */ new Map();
    this._allSingleCharSet = /* @__PURE__ */ new Set();
    this._singleCharToSets = /* @__PURE__ */ new Map();
    this._precomputedCounts = null;
    this.v1Deconstructor = new StyleDeconstructor(vectorEnhancer2);
    this.vectorEnhancer = vectorEnhancer2;
    this.positiveEmotionSet = new Set(POSITIVE_EMOTION_WORDS);
    this.negativeEmotionSet = new Set(NEGATIVE_EMOTION_WORDS);
    this.highIntensitySet = new Set(HIGH_INTENSITY_EMOTION_WORDS);
    this.mediumIntensitySet = new Set(MEDIUM_INTENSITY_EMOTION_WORDS);
    this.suspenseSet = new Set(SUSPENSE_WORDS);
    this.conflictSet = new Set(CONFLICT_WORDS);
    this.turningPointSet = new Set(TURNING_POINT_WORDS);
    this.foreshadowingSet = new Set(FORESHADOWING_MARKERS);
    this.visualSet = new Set(VISUAL_WORDS);
    this.auditorySet = new Set(AUDITORY_WORDS);
    this.tactileSet = new Set(TACTILE_WORDS);
    this.olfactorySet = new Set(OLFACTORY_WORDS);
    this.gustatorySet = new Set(GUSTATORY_WORDS);
    this.properNounSet = new Set(PROPER_NOUN_MARKERS);
    this.settingInjectionSet = new Set(SETTING_INJECTION_WORDS);
    this.archaismSet = new Set(ARCHAISM_WORDS);
    this.regionalSet = new Set(REGIONAL_WORDS);
    this.functionWordSet = new Set(FUNCTION_WORDS);
    this.commonWordSet = new Set(COMMON_WORDS);
    this.rhetoricalQuestionSet = new Set(RHETORICAL_QUESTION_MARKERS);
    this.timeJumpSet = new Set(TIME_JUMP_WORDS);
    this.sceneSwitchSet = new Set(SCENE_SWITCH_WORDS);
    this.narrativeNearSet = new Set(NARRATIVE_NEAR_WORDS);
    this.narrativeFarSet = new Set(NARRATIVE_FAR_WORDS);
    this._allKeywordSets = [
      this.positiveEmotionSet,
      this.negativeEmotionSet,
      this.highIntensitySet,
      this.mediumIntensitySet,
      this.suspenseSet,
      this.conflictSet,
      this.turningPointSet,
      this.foreshadowingSet,
      this.visualSet,
      this.auditorySet,
      this.tactileSet,
      this.olfactorySet,
      this.gustatorySet,
      this.properNounSet,
      this.settingInjectionSet,
      this.archaismSet,
      this.regionalSet,
      this.functionWordSet,
      this.commonWordSet,
      this.rhetoricalQuestionSet,
      this.timeJumpSet,
      this.sceneSwitchSet,
      this.narrativeNearSet,
      this.narrativeFarSet
    ];
    this._buildMergedKeywordStructures();
  }
  /**
   * 构建跨词表合并结构：
   * - 单字词：合并成一个大 Set，word -> 所属词表列表
   * - 多字词：构建一个大正则，word -> 所属词表列表
   * 这样一次遍历/匹配就能统计所有词表
   */
  _buildMergedKeywordStructures() {
    const allMultiCharWords = [];
    for (const keywordSet of this._allKeywordSets) {
      for (const word of keywordSet) {
        if (word.length === 0)
          continue;
        if (word.length === 1) {
          if (!this._allSingleCharSet.has(word)) {
            this._allSingleCharSet.add(word);
            this._singleCharToSets.set(word, []);
          }
          this._singleCharToSets.get(word).push(keywordSet);
        } else {
          if (!this._wordToSets.has(word)) {
            this._wordToSets.set(word, []);
            allMultiCharWords.push(word);
          }
          this._wordToSets.get(word).push(keywordSet);
        }
      }
    }
    allMultiCharWords.sort((a, b) => b.length - a.length);
    const pattern = allMultiCharWords.map((w) => this.escapeRegex(w)).join("|");
    this._allMultiCharRegex = new RegExp(pattern, "g");
  }
  /**
   * 预计算所有词表的 countKeywords 结果（一次遍历 + 一次正则匹配）
   */
  _precomputeAllKeywordCounts(text) {
    const counts = /* @__PURE__ */ new Map();
    for (const set of this._allKeywordSets) {
      counts.set(set, 0);
    }
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      const sets = this._singleCharToSets.get(char);
      if (sets) {
        for (const set of sets) {
          counts.set(set, counts.get(set) + 1);
        }
      }
    }
    if (this._allMultiCharRegex) {
      this._allMultiCharRegex.lastIndex = 0;
      const matches = text.match(this._allMultiCharRegex);
      if (matches) {
        for (const match of matches) {
          const sets = this._wordToSets.get(match);
          if (sets) {
            for (const set of sets) {
              counts.set(set, counts.get(set) + 1);
            }
          }
        }
      }
    }
    return counts;
  }
  /**
   * V2 12 维分析（异步，纯统计）
   * 兼容 V1：返回结果中包含 v1Result 字段
   */
  async analyze(text) {
    if (!text || text.length === 0) {
      return this.getEmptyResult();
    }
    this._cachedSentenceCharCounts.clear();
    this._cachedText = "";
    this._cachedChineseCharCount = -1;
    this._precomputedCounts = this._precomputeAllKeywordCounts(text);
    const v1Result = await this.v1Deconstructor.analyze(text);
    const paragraphs = this.splitParagraphs(text);
    const sentences = this.splitSentences(text);
    const totalChars = text.length;
    const features = {
      rhythm: this.analyzeRhythm(text, v1Result, sentences, paragraphs, totalChars),
      sentencePattern: this.analyzeSentencePattern(text, sentences, totalChars),
      wordChoice: this.analyzeWordChoice(text, v1Result, sentences, totalChars),
      rhetoric: this.analyzeRhetoric(text, v1Result, sentences, totalChars),
      perspective: this.analyzePerspective(text, v1Result, paragraphs, totalChars),
      emotion: this.analyzeEmotion(text, sentences, paragraphs, totalChars),
      tension: this.analyzeTension(text, sentences, paragraphs, totalChars),
      infoDensity: this.analyzeInfoDensity(text, sentences, paragraphs, totalChars),
      dialogue: this.analyzeDialogue(text, v1Result, totalChars),
      description: this.analyzeDescription(text, paragraphs, totalChars),
      narration: this.analyzeNarration(text, v1Result, paragraphs, totalChars),
      languageTexture: this.analyzeLanguageTexture(text, v1Result, sentences, totalChars)
    };
    this._precomputedCounts = null;
    return {
      features,
      stats: v1Result.stats,
      v1Result
    };
  }
  /**
   * V1 兼容方法：返回 V1 格式结果
   * 这是 V1 analyze 的包装器，确保完全向后兼容
   */
  async analyzeV1(text) {
    return await this.v1Deconstructor.analyze(text);
  }
  // ============================================================
  // 维度 1: RhythmStats — 节奏（V1 升级）
  // ============================================================
  analyzeRhythm(text, v1, sentences, paragraphs, totalChars) {
    const v1Rhythm = v1.sentenceRhythm;
    const lengthDistribution = v1Rhythm.lengthDistribution;
    const punctuationCount = (text.match(/[，。！？、；：…—""''「」『』（）·\-]/g) || []).length;
    const punctuationDensity = this.perThousand(punctuationCount, totalChars);
    const paragraphDensity = this.perThousand(paragraphs.length, totalChars);
    const pauseCount = (text.match(/[，、]/g) || []).length;
    const pauseFrequency = this.perThousand(pauseCount, totalChars);
    const samples = this.selectRhythmSamples(sentences, lengthDistribution);
    const description = this.generateRhythmDescription(
      lengthDistribution,
      v1Rhythm.avgSentenceLength,
      punctuationDensity,
      paragraphDensity
    );
    return {
      sentenceLengthDistribution: lengthDistribution,
      avgSentenceLength: v1Rhythm.avgSentenceLength,
      shortSentenceRatio: lengthDistribution.short,
      punctuationDensity,
      paragraphDensity,
      pauseFrequency,
      description,
      samples,
      status: "complete"
    };
  }
  generateRhythmDescription(dist, avgLen, punctDensity, paraDensity) {
    const parts = [];
    if (dist.short > 0.5) {
      parts.push(`\u672C\u6BB5\u8282\u594F\u504F\u5FEB\uFF0C\u77ED\u53E5\u5360\u6BD4 ${(dist.short * 100).toFixed(0)}%\uFF0C\u9002\u5408\u7D27\u5F20\u573A\u666F`);
    } else if (dist.long > 0.5) {
      parts.push(`\u672C\u6BB5\u8282\u594F\u8212\u7F13\uFF0C\u957F\u53E5\u5360\u6BD4 ${(dist.long * 100).toFixed(0)}%\uFF0C\u9002\u5408\u63CF\u5199\u94FA\u57AB`);
    } else {
      parts.push(`\u8282\u594F\u5747\u8861\uFF0C\u77ED\u53E5 ${(dist.short * 100).toFixed(0)}%\u3001\u4E2D\u53E5 ${(dist.medium * 100).toFixed(0)}%\u3001\u957F\u53E5 ${(dist.long * 100).toFixed(0)}%`);
    }
    parts.push(`\u5E73\u5747\u53E5\u957F ${avgLen.toFixed(1)} \u5B57`);
    if (punctDensity > 30) {
      parts.push("\u6807\u70B9\u5BC6\u96C6");
    } else if (punctDensity < 15) {
      parts.push("\u6807\u70B9\u7A00\u758F");
    }
    if (paraDensity > 5) {
      parts.push("\u6BB5\u843D\u77ED\u5C0F");
    }
    return parts.join("\uFF0C") + "\u3002";
  }
  selectRhythmSamples(sentences, dist) {
    const samples = [];
    const shortS = sentences.filter((s) => this.countChineseChars(s) <= 10);
    const longS = sentences.filter((s) => this.countChineseChars(s) > 30);
    if (dist.short > dist.long && shortS.length > 0) {
      samples.push(this.truncateSample(shortS[0]));
      if (shortS.length > 1)
        samples.push(this.truncateSample(shortS[Math.floor(shortS.length / 2)]));
    } else if (longS.length > 0) {
      samples.push(this.truncateSample(longS[0]));
      if (longS.length > 1)
        samples.push(this.truncateSample(longS[Math.floor(longS.length / 2)]));
    } else if (sentences.length > 0) {
      samples.push(this.truncateSample(sentences[0]));
    }
    return samples.slice(0, 3);
  }
  // ============================================================
  // 维度 2: SentencePatternStats — 句式（新增）
  // ============================================================
  analyzeSentencePattern(text, sentences, totalChars) {
    let inversionCount = 0;
    for (const pattern of INVERSION_PATTERNS) {
      const matches = text.match(pattern);
      if (matches)
        inversionCount += matches.length;
    }
    const inversionDensity = this.perThousand(inversionCount, totalChars);
    let ellipsisCount = 0;
    for (const s of sentences) {
      const len = this.countChineseChars(s);
      if (len < 6 && !/[说看听想走跑是的有在]/.test(s)) {
        ellipsisCount++;
      }
    }
    const ellipsisDensity = this.perThousand(ellipsisCount, totalChars);
    const parallelismCount = this.detectParallelism(sentences);
    const parallelismDensity = this.perThousand(parallelismCount, totalChars);
    const interrogativeSentences = sentences.filter((s) => /[？?]/.test(s));
    let rhetoricalCount = 0;
    for (const s of interrogativeSentences) {
      if (this.containsAny(s, this.rhetoricalQuestionSet)) {
        rhetoricalCount++;
      }
    }
    const rhetoricalQuestionRatio = interrogativeSentences.length > 0 ? rhetoricalCount / interrogativeSentences.length : 0;
    const nestingDepths = sentences.map((s) => {
      const commaCount = (s.match(/[，,]/g) || []).length;
      return Math.min(commaCount + 1, 5);
    });
    const clauseNestingDepth = sentences.length > 0 ? nestingDepths.reduce((a, b) => a + b, 0) / sentences.length : 0;
    const samples = this.selectSentencePatternSamples(sentences, rhetoricalQuestionRatio, parallelismDensity);
    const description = this.generateSentencePatternDescription(
      inversionDensity,
      ellipsisDensity,
      parallelismDensity,
      rhetoricalQuestionRatio,
      clauseNestingDepth
    );
    return {
      inversionDensity,
      ellipsisDensity,
      parallelismDensity,
      rhetoricalQuestionRatio: this.round2(rhetoricalQuestionRatio),
      clauseNestingDepth: this.round2(clauseNestingDepth),
      description,
      samples,
      status: "complete"
    };
  }
  generateSentencePatternDescription(inversion, ellipsis, parallelism, rhetorical, nesting) {
    const parts = [];
    if (parallelism > 2) {
      parts.push(`\u6392\u6BD4\u53E5\u5BC6\u5EA6\u9AD8\uFF08${parallelism.toFixed(1)}/\u5343\u5B57\uFF09`);
    }
    if (rhetorical > 0.3) {
      parts.push(`\u8BBE\u95EE\u53E5\u5360\u6BD4\u9AD8\uFF08${(rhetorical * 100).toFixed(0)}%\uFF09`);
    }
    if (ellipsis > 5) {
      parts.push(`\u7701\u7565\u53E5\u8F83\u591A\uFF08${ellipsis.toFixed(1)}/\u5343\u5B57\uFF09`);
    }
    if (inversion > 2) {
      parts.push(`\u5012\u88C5\u53E5\u5076\u73B0\uFF08${inversion.toFixed(1)}/\u5343\u5B57\uFF09`);
    }
    if (nesting > 2) {
      parts.push(`\u4ECE\u53E5\u5D4C\u5957\u8F83\u6DF1\uFF08\u5E73\u5747 ${nesting.toFixed(1)} \u5C42\uFF09`);
    } else if (nesting < 1.2) {
      parts.push("\u53E5\u5F0F\u7B80\u5355\u76F4\u63A5");
    }
    if (parts.length === 0) {
      parts.push("\u53E5\u5F0F\u5206\u5E03\u5747\u5300\uFF0C\u65E0\u660E\u663E\u7A81\u51FA\u7279\u5F81");
    }
    return parts.join("\uFF0C") + "\u3002";
  }
  selectSentencePatternSamples(sentences, rhetoricalRatio, parallelismDensity) {
    const samples = [];
    if (rhetoricalRatio > 0.1) {
      const rhetorical = sentences.filter(
        (s) => /[？?]/.test(s) && this.containsAny(s, this.rhetoricalQuestionSet)
      );
      if (rhetorical.length > 0) {
        samples.push(this.truncateSample(rhetorical[0]));
      }
    }
    if (parallelismDensity > 0 && sentences.length >= 3) {
      for (let i = 0; i < sentences.length - 2; i++) {
        const start1 = sentences[i].slice(0, 2);
        const start2 = sentences[i + 1].slice(0, 2);
        const start3 = sentences[i + 2].slice(0, 2);
        if (start1 === start2 && start2 === start3) {
          samples.push(this.truncateSample(sentences[i]));
          break;
        }
      }
    }
    if (samples.length < 2) {
      const longS = sentences.filter((s) => this.countChineseChars(s) > 20);
      if (longS.length > 0) {
        samples.push(this.truncateSample(longS[0]));
      }
    }
    return samples.slice(0, 3);
  }
  // ============================================================
  // 维度 3: WordChoiceStats — 用词（V1 升级）
  // ============================================================
  analyzeWordChoice(text, v1, sentences, totalChars) {
    const v1WordPref = v1.wordPreference;
    const commonCount = this.countKeywords(text, this.commonWordSet);
    const totalChineseChars = this.countChineseChars(text);
    const commonWordRatio = totalChineseChars > 0 ? Math.min(1, commonCount * 2 / totalChineseChars) : 0;
    const rareWordRatio = this.round2(Math.max(0, 1 - commonWordRatio));
    const functionCount = this.countKeywords(text, this.functionWordSet);
    const functionWordRatio = totalChineseChars > 0 ? Math.min(1, functionCount / totalChineseChars) : 0;
    const wordLengthDistribution = this.calculateWordLengthDistribution(text);
    const fourCharIdiomDensity = v1WordPref.idiomDensity;
    const samples = this.selectWordChoiceSamples(text, sentences, rareWordRatio, fourCharIdiomDensity);
    const description = this.generateWordChoiceDescription(
      commonWordRatio,
      rareWordRatio,
      functionWordRatio,
      fourCharIdiomDensity
    );
    return {
      commonWordRatio: this.round2(commonWordRatio),
      rareWordRatio,
      functionWordRatio: this.round2(functionWordRatio),
      wordLengthDistribution,
      fourCharIdiomDensity,
      description,
      samples,
      status: "complete"
    };
  }
  calculateWordLengthDistribution(text) {
    let len1 = 0, len2 = 0, len3 = 0, len4plus = 0;
    let total = 0;
    for (let i = 0; i < text.length; i++) {
      if (!this.isChineseChar(text[i]))
        continue;
      if (i + 1 < text.length && this.isChineseChar(text[i + 1])) {
        len2++;
        total++;
        i++;
      } else {
        len1++;
        total++;
      }
    }
    const safe = total || 1;
    return {
      len1: this.round2(len1 / safe),
      len2: this.round2(len2 / safe),
      len3: 0,
      len4plus: 0
    };
  }
  generateWordChoiceDescription(common, rare, func, idiom) {
    const parts = [];
    if (common > 0.6) {
      parts.push("\u4EE5\u5E38\u7528\u8BCD\u4E3A\u4E3B");
    } else if (rare > 0.4) {
      parts.push("\u751F\u50FB\u8BCD\u8F83\u591A");
    } else {
      parts.push("\u7528\u8BCD\u96BE\u5EA6\u9002\u4E2D");
    }
    if (func > 0.3) {
      parts.push(`\u865A\u8BCD\u6BD4\u4F8B\u504F\u9AD8\uFF08${(func * 100).toFixed(0)}%\uFF09`);
    }
    if (idiom > 3) {
      parts.push(`\u56DB\u5B57\u683C\u5BC6\u96C6\uFF08${idiom.toFixed(1)}/\u5343\u5B57\uFF09`);
    } else if (idiom < 0.5) {
      parts.push("\u56DB\u5B57\u683C\u8F83\u5C11");
    }
    return parts.join("\uFF0C") + "\u3002";
  }
  selectWordChoiceSamples(text, sentences, rareRatio, idiomDensity) {
    const samples = [];
    if (idiomDensity > 1) {
      const match = text.match(/[\u4e00-\u9fa5]{4}/);
      if (match) {
        const idx = text.indexOf(match[0]);
        samples.push(this.truncateSample(text.slice(Math.max(0, idx - 10), idx + 14)));
      }
    }
    if (rareRatio > 0.3 && samples.length < 2) {
      const longS = sentences.find((s) => this.countChineseChars(s) > 25);
      if (longS)
        samples.push(this.truncateSample(longS));
    }
    if (samples.length === 0) {
      if (sentences.length > 0) {
        samples.push(this.truncateSample(sentences[0]));
      }
    }
    return samples.slice(0, 3);
  }
  // ============================================================
  // 维度 4: RhetoricStatsV2 — 修辞（V1 升级）
  // ============================================================
  analyzeRhetoric(text, v1, sentences, totalChars) {
    const v1Rhetoric = v1.rhetoric;
    const metaphorDensity = this.perThousand(v1Rhetoric.metaphor, totalChars);
    const personificationDensity = this.perThousand(v1Rhetoric.personification, totalChars);
    const hyperboleDensity = this.perThousand(v1Rhetoric.hyperbole, totalChars);
    const parallelismDensity = this.perThousand(v1Rhetoric.parallelism, totalChars);
    const antithesisDensity = this.perThousand(v1Rhetoric.antithesis, totalChars);
    const synesthesiaCount = this.detectSynesthesia(text);
    const synesthesiaDensity = this.perThousand(synesthesiaCount, totalChars);
    const samples = this.selectRhetoricSamples(sentences, v1Rhetoric);
    const description = this.generateRhetoricDescription(
      metaphorDensity,
      personificationDensity,
      hyperboleDensity,
      parallelismDensity,
      antithesisDensity,
      synesthesiaDensity
    );
    return {
      metaphorDensity,
      personificationDensity,
      hyperboleDensity,
      parallelismDensity,
      antithesisDensity,
      synesthesiaDensity,
      description,
      samples,
      status: "complete"
    };
  }
  detectSynesthesia(text) {
    const sensoryWords = [
      ...VISUAL_WORDS.slice(0, 10),
      ...AUDITORY_WORDS.slice(0, 10),
      ...TACTILE_WORDS.slice(0, 10)
    ];
    let count = 0;
    const patterns = [
      /听[^。！？]{0,10}(看|见|颜色|色彩|明亮|黑暗)/g,
      /看[^。！？]{0,10}(声音|响|鸣|吵|静)/g,
      /声音[^。！？]{0,6}(冷|热|暖|硬|软|亮|暗)/g,
      /气味[^。！？]{0,6}(甜|苦|酸|辣|冷|热)/g
    ];
    for (const p of patterns) {
      const m = text.match(p);
      if (m)
        count += m.length;
    }
    return count;
  }
  generateRhetoricDescription(metaphor, personification, hyperbole, parallelism, antithesis, synesthesia) {
    const parts = [];
    if (metaphor > 3)
      parts.push(`\u6BD4\u55BB\u5BC6\u96C6\uFF08${metaphor.toFixed(1)}/\u5343\u5B57\uFF09`);
    if (personification > 1)
      parts.push(`\u62DF\u4EBA\u8F83\u591A\uFF08${personification.toFixed(1)}/\u5343\u5B57\uFF09`);
    if (hyperbole > 0.5)
      parts.push("\u5938\u5F20\u5076\u73B0");
    if (parallelism > 1)
      parts.push(`\u6392\u6BD4\u6709\u529B\uFF08${parallelism.toFixed(1)}/\u5343\u5B57\uFF09`);
    if (antithesis > 0.5)
      parts.push("\u5BF9\u5076\u5DE5\u6574");
    if (synesthesia > 0.3)
      parts.push("\u901A\u611F\u624B\u6CD5\u70B9\u7F00");
    if (parts.length === 0)
      parts.push("\u4FEE\u8F9E\u624B\u6CD5\u8F83\u5C11\uFF0C\u8BED\u8A00\u6734\u7D20");
    return parts.join("\uFF0C") + "\u3002";
  }
  selectRhetoricSamples(sentences, v1Rhetoric) {
    const samples = [];
    if (v1Rhetoric.metaphor > 0) {
      const metaphorS = sentences.find((s) => /[像如似仿佛犹如宛如]/.test(s));
      if (metaphorS)
        samples.push(this.truncateSample(metaphorS));
    }
    if (v1Rhetoric.parallelism > 0) {
      for (let i = 0; i < sentences.length - 2; i++) {
        if (sentences[i].slice(0, 2) === sentences[i + 1].slice(0, 2)) {
          samples.push(this.truncateSample(sentences[i]));
          break;
        }
      }
    }
    if (samples.length < 2 && sentences.length > 0) {
      samples.push(this.truncateSample(sentences[0]));
    }
    return samples.slice(0, 3);
  }
  // ============================================================
  // 维度 5: PerspectiveStats — 视角（V1 升级）
  // ============================================================
  analyzePerspective(text, v1, paragraphs, totalChars) {
    const v1Narrative = v1.narrativeStyle;
    const firstCount = (text.match(/我[们们]?/g) || []).length;
    const secondCount = (text.match(/[你妳]们?/g) || []).length;
    const thirdCount = (text.match(/[他她它]们?/g) || []).length;
    const personTotal = firstCount + secondCount + thirdCount || 1;
    const personDistribution = {
      first: this.round2(firstCount / personTotal),
      second: this.round2(secondCount / personTotal),
      third: this.round2(thirdCount / personTotal)
    };
    let switchCount = 0;
    for (let i = 1; i < paragraphs.length; i++) {
      const prevStart = paragraphs[i - 1].slice(0, 2);
      const currStart = paragraphs[i].slice(0, 2);
      if (prevStart !== currStart && (/^[我你他她它]/.test(prevStart) || /^[我你他她它]/.test(currStart))) {
        switchCount++;
      }
    }
    const perspectiveSwitchFrequency = this.perThousand(switchCount, totalChars);
    const nearCount = this.countKeywords(text, this.narrativeNearSet);
    const farCount = this.countKeywords(text, this.narrativeFarSet);
    const distTotal = nearCount + farCount || 1;
    const narrativeDistance = {
      far: this.round2(farCount / distTotal),
      medium: this.round2(0),
      // 简化：中等距离取剩余
      near: this.round2(nearCount / distTotal)
    };
    narrativeDistance.medium = this.round2(Math.max(0, 1 - narrativeDistance.far - narrativeDistance.near));
    const samples = this.selectPerspectiveSamples(paragraphs, personDistribution);
    const description = this.generatePerspectiveDescription(
      personDistribution,
      perspectiveSwitchFrequency,
      narrativeDistance,
      v1Narrative.perspective
    );
    return {
      personDistribution,
      perspectiveSwitchFrequency,
      narrativeDistance,
      description,
      samples,
      status: "complete"
    };
  }
  generatePerspectiveDescription(person, switchFreq, distance, v1Perspective) {
    const parts = [];
    if (person.first > 0.5) {
      parts.push("\u7B2C\u4E00\u4EBA\u79F0\u4E3A\u4E3B\uFF0C\u4EE3\u5165\u611F\u5F3A");
    } else if (person.third > 0.7) {
      parts.push("\u7B2C\u4E09\u4EBA\u79F0\u53D9\u8FF0");
    } else {
      parts.push("\u4EBA\u79F0\u89C6\u89D2\u6DF7\u5408");
    }
    if (switchFreq > 3) {
      parts.push(`\u89C6\u89D2\u5207\u6362\u9891\u7E41\uFF08${switchFreq.toFixed(1)}/\u5343\u5B57\uFF09`);
    } else if (switchFreq < 0.5) {
      parts.push("\u89C6\u89D2\u7A33\u5B9A");
    }
    if (distance.near > 0.6) {
      parts.push("\u53D9\u8FF0\u8DDD\u79BB\u8D34\u8FD1\u5185\u5FC3");
    } else if (distance.far > 0.6) {
      parts.push("\u53D9\u8FF0\u8DDD\u79BB\u8F83\u8FDC\uFF0C\u5BA2\u89C2\u514B\u5236");
    }
    return parts.join("\uFF0C") + "\u3002";
  }
  selectPerspectiveSamples(paragraphs, person) {
    const samples = [];
    if (person.first > 0.3) {
      const firstP = paragraphs.find((p) => /^我/.test(p.trim()));
      if (firstP)
        samples.push(this.truncateSample(firstP));
    }
    if (person.third > 0.3) {
      const thirdP = paragraphs.find((p) => /^[他她它]/.test(p.trim()));
      if (thirdP)
        samples.push(this.truncateSample(thirdP));
    }
    if (samples.length === 0 && paragraphs.length > 0) {
      samples.push(this.truncateSample(paragraphs[0]));
    }
    return samples.slice(0, 3);
  }
  // ============================================================
  // 维度 6: EmotionStats — 情绪（新增）
  // ============================================================
  analyzeEmotion(text, sentences, paragraphs, totalChars) {
    const positiveCount = this.countKeywords(text, this.positiveEmotionSet);
    const negativeCount = this.countKeywords(text, this.negativeEmotionSet);
    const highIntensityCount = this.countKeywords(text, this.highIntensitySet);
    const mediumIntensityCount = this.countKeywords(text, this.mediumIntensitySet);
    const totalEmotion = positiveCount + negativeCount;
    const valenceTotal = totalEmotion || 1;
    const valenceRatio = {
      positive: this.round2(positiveCount / valenceTotal),
      negative: this.round2(negativeCount / valenceTotal),
      neutral: this.round2(0)
      // 简化：中性情绪不单独统计
    };
    valenceRatio.neutral = this.round2(Math.max(0, 1 - valenceRatio.positive - valenceRatio.negative));
    const emotionalTone = this.determineEmotionalTone(positiveCount, negativeCount, highIntensityCount);
    const fluctuationCount = this.countEmotionFluctuations(sentences);
    const emotionalFluctuationFrequency = this.perThousand(fluctuationCount, totalChars);
    const intensityTotal = highIntensityCount + mediumIntensityCount + Math.max(0, totalEmotion - highIntensityCount - mediumIntensityCount) || 1;
    const lowIntensityCount = Math.max(0, totalEmotion - highIntensityCount - mediumIntensityCount);
    const emotionalIntensityDistribution = {
      low: this.round2(lowIntensityCount / intensityTotal),
      medium: this.round2(mediumIntensityCount / intensityTotal),
      high: this.round2(highIntensityCount / intensityTotal)
    };
    const samples = this.selectEmotionSamples(sentences, positiveCount, negativeCount);
    const description = this.generateEmotionDescription(
      emotionalTone,
      emotionalFluctuationFrequency,
      emotionalIntensityDistribution,
      valenceRatio
    );
    return {
      emotionalTone,
      emotionalFluctuationFrequency,
      emotionalIntensityDistribution,
      valenceRatio,
      description,
      samples,
      status: "complete"
    };
  }
  determineEmotionalTone(positive, negative, highIntensity) {
    if (positive + negative === 0)
      return "\u5E73\u6DE1";
    const positiveRatio = positive / (positive + negative);
    if (highIntensity > 3) {
      return positiveRatio > 0.5 ? "\u6602\u626C" : "\u6FC0\u8D8A";
    }
    if (positiveRatio > 0.7)
      return "\u6109\u60A6";
    if (negative > positive * 1.5)
      return "\u538B\u6291";
    if (positive > negative * 1.5)
      return "\u660E\u6717";
    return "\u5E73\u9759";
  }
  countEmotionFluctuations(sentences) {
    let fluctuation = 0;
    let prevValence = "neutral";
    for (const s of sentences) {
      const hasPos = this.containsAny(s, this.positiveEmotionSet);
      const hasNeg = this.containsAny(s, this.negativeEmotionSet);
      const current = hasPos && !hasNeg ? "pos" : hasNeg && !hasPos ? "neg" : "neutral";
      if (current !== "neutral" && current !== prevValence && prevValence !== "neutral") {
        fluctuation++;
      }
      if (current !== "neutral")
        prevValence = current;
    }
    return fluctuation;
  }
  generateEmotionDescription(tone, fluctuation, intensity, valence) {
    const parts = [];
    parts.push(`\u60C5\u7EEA\u57FA\u8C03\u4E3A${tone}`);
    if (valence.positive > 0.6) {
      parts.push(`\u6B63\u5411\u60C5\u7EEA\u5360\u4E3B\u5BFC\uFF08${(valence.positive * 100).toFixed(0)}%\uFF09`);
    } else if (valence.negative > 0.6) {
      parts.push(`\u8D1F\u5411\u60C5\u7EEA\u7A81\u51FA\uFF08${(valence.negative * 100).toFixed(0)}%\uFF09`);
    }
    if (intensity.high > 0.3) {
      parts.push("\u9AD8\u5F3A\u5EA6\u60C5\u7EEA\u8BCD\u5BC6\u96C6");
    } else if (intensity.low > 0.6) {
      parts.push("\u60C5\u7EEA\u5F3A\u5EA6\u504F\u4F4E");
    }
    if (fluctuation > 3) {
      parts.push(`\u60C5\u7EEA\u6CE2\u52A8\u9891\u7E41\uFF08${fluctuation.toFixed(1)}/\u5343\u5B57\uFF09`);
    }
    return parts.join("\uFF0C") + "\u3002";
  }
  selectEmotionSamples(sentences, positiveCount, negativeCount) {
    const samples = [];
    if (positiveCount >= negativeCount) {
      const posS = sentences.find((s) => this.containsAny(s, this.positiveEmotionSet));
      if (posS)
        samples.push(this.truncateSample(posS));
    }
    if (negativeCount > 0) {
      const negS = sentences.find((s) => this.containsAny(s, this.negativeEmotionSet));
      if (negS)
        samples.push(this.truncateSample(negS));
    }
    if (samples.length < 2 && sentences.length > 0) {
      samples.push(this.truncateSample(sentences[0]));
    }
    return samples.slice(0, 3);
  }
  // ============================================================
  // 维度 7: TensionStats — 张力（新增）
  // ============================================================
  analyzeTension(text, sentences, paragraphs, totalChars) {
    const suspenseCount = this.countKeywords(text, this.suspenseSet);
    const suspenseDensity = this.perThousand(suspenseCount, totalChars);
    const conflictCount = this.countKeywords(text, this.conflictSet);
    const conflictFrequency = this.perThousand(conflictCount, totalChars);
    const turningCount = this.countKeywords(text, this.turningPointSet);
    const turningPointDensity = this.perThousand(turningCount, totalChars);
    let foreshadowingCount = 0;
    for (const marker of FORESHADOWING_MARKERS) {
      const count = text.split(marker).length - 1;
      foreshadowingCount += count;
    }
    const foreshadowingMarkerCount = this.perThousand(foreshadowingCount, totalChars);
    const climaxDistribution = this.calculateClimaxDistribution(paragraphs);
    const samples = this.selectTensionSamples(sentences, suspenseDensity, turningPointDensity);
    const description = this.generateTensionDescription(
      suspenseDensity,
      conflictFrequency,
      turningPointDensity,
      foreshadowingMarkerCount,
      climaxDistribution
    );
    return {
      suspenseDensity,
      conflictFrequency,
      turningPointDensity,
      foreshadowingMarkerCount,
      climaxDistribution,
      description,
      samples,
      status: "complete"
    };
  }
  calculateClimaxDistribution(paragraphs) {
    if (paragraphs.length === 0) {
      return { early: 0, middle: 0, late: 0 };
    }
    const third = Math.max(1, Math.floor(paragraphs.length / 3));
    const earlyParas = paragraphs.slice(0, third);
    const middleParas = paragraphs.slice(third, third * 2);
    const lateParas = paragraphs.slice(third * 2);
    const calcTension = (paras) => {
      return paras.reduce((sum, p) => {
        const s = this.countKeywordsInText(p, this.suspenseSet);
        const c = this.countKeywordsInText(p, this.conflictSet);
        const t = this.countKeywordsInText(p, this.turningPointSet);
        return sum + s + c + t;
      }, 0);
    };
    const earlyT = calcTension(earlyParas);
    const middleT = calcTension(middleParas);
    const lateT = calcTension(lateParas);
    const total = earlyT + middleT + lateT || 1;
    return {
      early: this.round2(earlyT / total),
      middle: this.round2(middleT / total),
      late: this.round2(lateT / total)
    };
  }
  generateTensionDescription(suspense, conflict, turning, foreshadowing, climax) {
    const parts = [];
    if (suspense > 5) {
      parts.push(`\u60AC\u5FF5\u5BC6\u96C6\uFF08${suspense.toFixed(1)}/\u5343\u5B57\uFF09`);
    } else if (suspense > 1) {
      parts.push("\u60AC\u5FF5\u9002\u5EA6");
    }
    if (conflict > 3) {
      parts.push(`\u51B2\u7A81\u6FC0\u70C8\uFF08${conflict.toFixed(1)}/\u5343\u5B57\uFF09`);
    }
    if (turning > 2) {
      parts.push(`\u8F6C\u6298\u9891\u7E41\uFF08${turning.toFixed(1)}/\u5343\u5B57\uFF09`);
    }
    if (foreshadowing > 1) {
      parts.push("\u4F0F\u7B14\u6807\u8BB0\u8F83\u591A");
    }
    if (climax.late > 0.5) {
      parts.push("\u9AD8\u6F6E\u96C6\u4E2D\u4E8E\u540E\u6BB5");
    } else if (climax.early > 0.4) {
      parts.push("\u5F00\u7BC7\u5373\u9AD8\u6F6E");
    } else if (climax.middle > 0.4) {
      parts.push("\u9AD8\u6F6E\u5C45\u4E2D");
    }
    if (parts.length === 0)
      parts.push("\u5F20\u529B\u5E73\u7F13");
    return parts.join("\uFF0C") + "\u3002";
  }
  selectTensionSamples(sentences, suspenseDensity, turningDensity) {
    const samples = [];
    if (suspenseDensity > 0.5) {
      const suspS = sentences.find((s) => this.containsAny(s, this.suspenseSet));
      if (suspS)
        samples.push(this.truncateSample(suspS));
    }
    if (turningDensity > 0.5) {
      const turnS = sentences.find((s) => this.containsAny(s, this.turningPointSet));
      if (turnS)
        samples.push(this.truncateSample(turnS));
    }
    if (samples.length < 2 && sentences.length > 0) {
      const emotional = sentences.find((s) => /[！？!?]/.test(s));
      if (emotional)
        samples.push(this.truncateSample(emotional));
    }
    return samples.slice(0, 3);
  }
  // ============================================================
  // 维度 8: InfoDensityStats — 信息量（新增）
  // ============================================================
  analyzeInfoDensity(text, sentences, paragraphs, totalChars) {
    const totalChineseChars = this.countChineseChars(text);
    const functionCount = this.countKeywords(text, this.functionWordSet);
    const infoDensity = totalChineseChars > 0 ? Math.max(0, (totalChineseChars - functionCount) / totalChineseChars) : 0;
    const properNounCount = this.countKeywords(text, this.properNounSet);
    const properNounDensity = this.perThousand(properNounCount, totalChars);
    const settingCount = this.countKeywords(text, this.settingInjectionSet);
    const settingInjectionFrequency = this.perThousand(settingCount, totalChars);
    const conceptCount = properNounCount + settingCount;
    const conceptIntroductionRhythm = this.perThousand(conceptCount, totalChars);
    const samples = this.selectInfoDensitySamples(sentences, properNounDensity, settingInjectionFrequency);
    const description = this.generateInfoDensityDescription(
      infoDensity,
      properNounDensity,
      settingInjectionFrequency,
      conceptIntroductionRhythm
    );
    return {
      infoDensity: this.round2(infoDensity),
      properNounDensity,
      settingInjectionFrequency,
      conceptIntroductionRhythm,
      description,
      samples,
      status: "complete"
    };
  }
  generateInfoDensityDescription(info, properNoun, setting, concept) {
    const parts = [];
    if (info > 0.7) {
      parts.push("\u4FE1\u606F\u5BC6\u5EA6\u9AD8");
    } else if (info < 0.4) {
      parts.push("\u4FE1\u606F\u5BC6\u5EA6\u504F\u4F4E");
    } else {
      parts.push("\u4FE1\u606F\u5BC6\u5EA6\u9002\u4E2D");
    }
    if (properNoun > 5) {
      parts.push(`\u4E13\u6709\u540D\u8BCD\u5BC6\u96C6\uFF08${properNoun.toFixed(1)}/\u5343\u5B57\uFF09`);
    }
    if (setting > 2) {
      parts.push(`\u8BBE\u5B9A\u690D\u5165\u9891\u7E41\uFF08${setting.toFixed(1)}/\u5343\u5B57\uFF09`);
    }
    if (concept > 8) {
      parts.push("\u6982\u5FF5\u5F15\u5165\u8282\u594F\u5FEB");
    } else if (concept < 2) {
      parts.push("\u6982\u5FF5\u5F15\u5165\u8282\u594F\u8212\u7F13");
    }
    return parts.join("\uFF0C") + "\u3002";
  }
  selectInfoDensitySamples(sentences, properNounDensity, settingDensity) {
    const samples = [];
    if (settingDensity > 0.5) {
      const settingS = sentences.find((s) => this.containsAny(s, this.settingInjectionSet));
      if (settingS)
        samples.push(this.truncateSample(settingS));
    }
    if (properNounDensity > 2 && samples.length < 2) {
      const properS = sentences.find((s) => this.containsAny(s, this.properNounSet));
      if (properS)
        samples.push(this.truncateSample(properS));
    }
    if (samples.length < 2 && sentences.length > 0) {
      samples.push(this.truncateSample(sentences[0]));
    }
    return samples.slice(0, 3);
  }
  // ============================================================
  // 维度 9: DialogueStatsV2 — 对话（V1 升级）
  // ============================================================
  analyzeDialogue(text, v1, totalChars) {
    const v1Dialogue = v1.dialogueStyle;
    const dialogues = this.extractDialogues(text);
    const dialogueStyleTag = this.determineDialogueStyleTag(v1Dialogue);
    const personalizationLevel = this.calculatePersonalizationLevel(dialogues, v1Dialogue);
    const subtextRatio = this.calculateSubtextRatio(dialogues);
    const samples = this.selectDialogueSamples(dialogues);
    const description = this.generateDialogueDescription(
      v1Dialogue.dialogueRatio,
      dialogueStyleTag,
      personalizationLevel,
      subtextRatio
    );
    return {
      dialogueRatio: v1Dialogue.dialogueRatio,
      dialogueStyleTag,
      personalizationLevel,
      subtextRatio,
      description,
      samples,
      status: "complete"
    };
  }
  determineDialogueStyleTag(v1Dialogue) {
    if (v1Dialogue.avgDialogueLength < 8)
      return "\u7B80\u7EC3";
    if (v1Dialogue.avgDialogueLength > 25)
      return "\u5570\u55E6";
    if (v1Dialogue.lengthDistribution.short > 0.6)
      return "\u5E72\u8106";
    if (v1Dialogue.lengthDistribution.long > 0.4)
      return "\u5197\u957F";
    return "\u9002\u4E2D";
  }
  calculatePersonalizationLevel(dialogues, v1Dialogue) {
    if (dialogues.length < 2)
      return 0;
    const lengths = dialogues.map((d) => d.length);
    const avg = lengths.reduce((a, b) => a + b, 0) / lengths.length;
    const variance = lengths.reduce((sum, l) => sum + (l - avg) ** 2, 0) / lengths.length;
    const stdDev = Math.sqrt(variance);
    const lengthDiversity = Math.min(1, stdDev / 15);
    const promptDiversity = v1Dialogue.promptWordPreference.length > 5 ? 0.5 : 0.3;
    return this.round2(Math.min(1, lengthDiversity * 0.6 + promptDiversity));
  }
  calculateSubtextRatio(dialogues) {
    if (dialogues.length === 0)
      return 0;
    const subtextMarkers = ["...", "\u2026\u2026", "\uFF1F", "?", "\u96BE\u9053", "\u5C82", "\u4F55\u5FC5", "\u4F55\u4E0D"];
    let subtextCount = 0;
    for (const d of dialogues) {
      if (subtextMarkers.some((m) => d.includes(m))) {
        subtextCount++;
      }
    }
    return this.round2(subtextCount / dialogues.length);
  }
  generateDialogueDescription(ratio, tag, personalization, subtext) {
    const parts = [];
    if (ratio > 0.4) {
      parts.push(`\u5BF9\u8BDD\u5360\u6BD4\u9AD8\uFF08${(ratio * 100).toFixed(0)}%\uFF09`);
    } else if (ratio < 0.1) {
      parts.push("\u5BF9\u8BDD\u8F83\u5C11");
    }
    parts.push(`\u5BF9\u8BDD\u98CE\u683C${tag}`);
    if (personalization > 0.6) {
      parts.push("\u53F0\u8BCD\u4E2A\u6027\u5316\u5F3A");
    } else if (personalization < 0.3) {
      parts.push("\u53F0\u8BCD\u8F83\u4E3A\u96F7\u540C");
    }
    if (subtext > 0.3) {
      parts.push(`\u6F5C\u53F0\u8BCD\u4E30\u5BCC\uFF08${(subtext * 100).toFixed(0)}%\uFF09`);
    }
    return parts.join("\uFF0C") + "\u3002";
  }
  selectDialogueSamples(dialogues) {
    const samples = dialogues.slice(0, 3).map((d) => this.truncateSample(d));
    return samples;
  }
  // ============================================================
  // 维度 10: DescriptionStats — 描写（新增）
  // ============================================================
  analyzeDescription(text, paragraphs, totalChars) {
    const envKeywords = [
      "\u5929\u7A7A",
      "\u5927\u5730",
      "\u5C71\u5DDD",
      "\u6CB3\u6D41",
      "\u68EE\u6797",
      "\u57CE\u5E02",
      "\u8857\u9053",
      "\u623F\u95F4",
      "\u5BAB\u6BBF",
      "\u5C71\u8C37",
      "\u9633\u5149",
      "\u6708\u5149",
      "\u661F\u5149",
      "\u98CE\u96E8",
      "\u96F7\u7535",
      "\u4E91\u96FE",
      "\u82B1\u8349",
      "\u6811\u6728",
      "\u5EFA\u7B51",
      "\u666F\u8272"
    ];
    const envSet = new Set(envKeywords);
    const envCount = this.countKeywords(text, envSet);
    const environmentDescriptionRatio = totalChars > 0 ? Math.min(1, envCount * 10 / totalChars) : 0;
    const adjCount = (text.match(/美丽|漂亮|英俊|高大|矮小|强壮|聪明|善良|勇敢|温柔|冷酷|热情|开心|难过|愤怒|平静|紧张|华丽|朴素|豪华|简陋|干净|肮脏|明亮|黑暗/g) || []).length;
    const advCount = (text.match(/非常|十分|极其|格外|特别|相当|很|最|更|比较|忽然|突然|渐渐|慢慢|缓缓|迅速|快速|立即|马上|顿时|轻轻地|悄悄地|默默地/g) || []).length;
    const detailDensity = this.perHundred(adjCount + advCount, totalChars);
    const visualCount = this.countKeywords(text, this.visualSet);
    const auditoryCount = this.countKeywords(text, this.auditorySet);
    const tactileCount = this.countKeywords(text, this.tactileSet);
    const olfactoryCount = this.countKeywords(text, this.olfactorySet);
    const gustatoryCount = this.countKeywords(text, this.gustatorySet);
    const sensoryTotal = visualCount + auditoryCount + tactileCount + olfactoryCount + gustatoryCount || 1;
    const sensoryDistribution = {
      visual: this.round2(visualCount / sensoryTotal),
      auditory: this.round2(auditoryCount / sensoryTotal),
      tactile: this.round2(tactileCount / sensoryTotal),
      olfactory: this.round2(olfactoryCount / sensoryTotal),
      gustatory: this.round2(gustatoryCount / sensoryTotal)
    };
    const samples = this.selectDescriptionSamples(paragraphs, sensoryDistribution);
    const description = this.generateDescriptionDescription(
      environmentDescriptionRatio,
      detailDensity,
      sensoryDistribution
    );
    return {
      environmentDescriptionRatio: this.round2(environmentDescriptionRatio),
      detailDensity,
      sensoryDistribution,
      description,
      samples,
      status: "complete"
    };
  }
  generateDescriptionDescription(envRatio, detail, sensory) {
    const parts = [];
    if (envRatio > 0.3) {
      parts.push("\u73AF\u5883\u63CF\u5199\u4E30\u5BCC");
    } else if (envRatio < 0.05) {
      parts.push("\u73AF\u5883\u63CF\u5199\u8F83\u5C11");
    }
    if (detail > 5) {
      parts.push(`\u7EC6\u8282\u5BC6\u5EA6\u9AD8\uFF08${detail.toFixed(1)}/\u767E\u5B57\uFF09`);
    }
    const dominantSense = Object.entries(sensory).sort((a, b) => b[1] - a[1])[0];
    const senseNames = {
      visual: "\u89C6\u89C9",
      auditory: "\u542C\u89C9",
      tactile: "\u89E6\u89C9",
      olfactory: "\u55C5\u89C9",
      gustatory: "\u5473\u89C9"
    };
    if (dominantSense && dominantSense[1] > 0.5) {
      parts.push(`\u4EE5${senseNames[dominantSense[0]]}\u63CF\u5199\u4E3A\u4E3B`);
    } else if (dominantSense && dominantSense[1] > 0) {
      parts.push("\u591A\u611F\u5B98\u63CF\u5199\u5E76\u5B58");
    }
    return parts.join("\uFF0C") + "\u3002";
  }
  selectDescriptionSamples(paragraphs, sensory) {
    const samples = [];
    const envKeywords = ["\u5929\u7A7A", "\u5927\u5730", "\u5C71\u5DDD", "\u6CB3\u6D41", "\u68EE\u6797", "\u9633\u5149", "\u6708\u5149", "\u666F\u8272"];
    const envPara = paragraphs.find((p) => envKeywords.some((k) => p.includes(k)));
    if (envPara)
      samples.push(this.truncateSample(envPara));
    if (sensory.visual > 0.3) {
      const visualPara = paragraphs.find((p) => VISUAL_WORDS.slice(0, 10).some((k) => p.includes(k)));
      if (visualPara && samples.length < 2)
        samples.push(this.truncateSample(visualPara));
    }
    if (samples.length < 2 && paragraphs.length > 0) {
      samples.push(this.truncateSample(paragraphs[0]));
    }
    return samples.slice(0, 3);
  }
  // ============================================================
  // 维度 11: NarrationStats — 叙事（V1 升级）
  // ============================================================
  analyzeNarration(text, v1, paragraphs, totalChars) {
    const sceneSwitchCount = this.countKeywords(text, this.sceneSwitchSet);
    const narrationSpeed = this.perThousand(paragraphs.length + sceneSwitchCount, totalChars);
    const timeJumpCount = this.countKeywords(text, this.timeJumpSet);
    const timeJumpFrequency = this.perThousand(timeJumpCount, totalChars);
    const sceneSwitchFrequency = this.perThousand(sceneSwitchCount, totalChars);
    const samples = this.selectNarrationSamples(paragraphs, timeJumpFrequency, sceneSwitchFrequency);
    const description = this.generateNarrationDescription(
      narrationSpeed,
      timeJumpFrequency,
      sceneSwitchFrequency,
      v1.paragraphStructure
    );
    return {
      narrationSpeed,
      timeJumpFrequency,
      sceneSwitchFrequency,
      description,
      samples,
      status: "complete"
    };
  }
  generateNarrationDescription(speed, timeJump, sceneSwitch, v1Paragraph) {
    const parts = [];
    if (speed > 10) {
      parts.push("\u53D9\u4E8B\u901F\u5EA6\u5FEB");
    } else if (speed < 3) {
      parts.push("\u53D9\u4E8B\u8282\u594F\u8212\u7F13");
    }
    if (timeJump > 2) {
      parts.push(`\u65F6\u95F4\u8DF3\u8DC3\u9891\u7E41\uFF08${timeJump.toFixed(1)}/\u5343\u5B57\uFF09`);
    }
    if (sceneSwitch > 1) {
      parts.push(`\u573A\u666F\u5207\u6362\u8F83\u591A\uFF08${sceneSwitch.toFixed(1)}/\u5343\u5B57\uFF09`);
    }
    if (v1Paragraph.lengthDistribution.short > 0.5) {
      parts.push("\u6BB5\u843D\u77ED\u5C0F\uFF0C\u8282\u594F\u660E\u5FEB");
    } else if (v1Paragraph.lengthDistribution.veryLong > 0.3) {
      parts.push("\u6BB5\u843D\u5197\u957F");
    }
    return parts.join("\uFF0C") + "\u3002";
  }
  selectNarrationSamples(paragraphs, timeJumpFreq, sceneSwitchFreq) {
    const samples = [];
    if (timeJumpFreq > 0.5) {
      const jumpPara = paragraphs.find((p) => this.containsAny(p, this.timeJumpSet));
      if (jumpPara)
        samples.push(this.truncateSample(jumpPara));
    }
    if (sceneSwitchFreq > 0.5 && samples.length < 2) {
      const switchPara = paragraphs.find((p) => this.containsAny(p, this.sceneSwitchSet));
      if (switchPara)
        samples.push(this.truncateSample(switchPara));
    }
    if (samples.length < 2 && paragraphs.length > 0) {
      samples.push(this.truncateSample(paragraphs[0]));
    }
    return samples.slice(0, 3);
  }
  // ============================================================
  // 维度 12: LanguageTextureStats — 语言质感（V1 升级）
  // ============================================================
  analyzeLanguageTexture(text, v1, sentences, totalChars) {
    const v1WordPref = v1.wordPreference;
    const colloquialLevel = v1WordPref.colloquialismLevel;
    const writtenLevel = this.round2(1 - colloquialLevel);
    const archaismCount = this.countKeywords(text, this.archaismSet);
    const totalChineseChars = this.countChineseChars(text);
    const archaismLevel = totalChineseChars > 0 ? Math.min(1, archaismCount / (totalChineseChars * 0.1)) : 0;
    const regionalCount = this.countKeywords(text, this.regionalSet);
    const regionalWordDensity = this.perThousand(regionalCount, totalChars);
    const samples = this.selectLanguageTextureSamples(sentences, archaismLevel, regionalWordDensity);
    const description = this.generateLanguageTextureDescription(
      writtenLevel,
      colloquialLevel,
      archaismLevel,
      regionalWordDensity
    );
    return {
      writtenLevel,
      colloquialLevel,
      archaismLevel: this.round2(archaismLevel),
      regionalWordDensity,
      description,
      samples,
      status: "complete"
    };
  }
  generateLanguageTextureDescription(written, colloquial, archaism, regional) {
    const parts = [];
    if (written > 0.7) {
      parts.push("\u8BED\u8A00\u4E66\u9762\u5316");
    } else if (colloquial > 0.5) {
      parts.push("\u8BED\u8A00\u53E3\u8BED\u5316");
    } else {
      parts.push("\u8BED\u8A00\u96C5\u4FD7\u5171\u8D4F");
    }
    if (archaism > 0.3) {
      parts.push("\u53E4\u98CE\u97F5\u5473\u6D53\u539A");
    } else if (archaism > 0.1) {
      parts.push("\u5076\u6709\u53E4\u98CE\u7528\u8BCD");
    }
    if (regional > 2) {
      parts.push(`\u5730\u57DF\u7279\u8272\u660E\u663E\uFF08${regional.toFixed(1)}/\u5343\u5B57\uFF09`);
    }
    return parts.join("\uFF0C") + "\u3002";
  }
  selectLanguageTextureSamples(sentences, archaismLevel, regionalDensity) {
    const samples = [];
    if (archaismLevel > 0.1) {
      const archaismS = sentences.find((s) => this.containsAny(s, this.archaismSet));
      if (archaismS)
        samples.push(this.truncateSample(archaismS));
    }
    if (regionalDensity > 1 && samples.length < 2) {
      const regionalS = sentences.find((s) => this.containsAny(s, this.regionalSet));
      if (regionalS)
        samples.push(this.truncateSample(regionalS));
    }
    if (samples.length < 2 && sentences.length > 0) {
      samples.push(this.truncateSample(sentences[0]));
    }
    return samples.slice(0, 3);
  }
  // ============================================================
  // 工具方法
  // ============================================================
  getEmptyResult() {
    const emptyV1 = {
      sentenceRhythm: {
        avgSentenceLength: 0,
        medianSentenceLength: 0,
        stdSentenceLength: 0,
        sentenceTypeDistribution: { declarative: 0, interrogative: 0, exclamatory: 0, elliptical: 0 },
        lengthDistribution: { short: 0, medium: 0, long: 0 }
      },
      wordPreference: {
        topWords: [],
        posPreference: { verb: 0, adjective: 0, adverb: 0 },
        modalParticles: { total: 0, perThousand: 0, topParticles: [] },
        idiomDensity: 0,
        colloquialismLevel: 0
      },
      narrativeStyle: {
        perspective: "third_person_omniscient",
        perspectiveConfidence: 0,
        descriptionRatio: { appearance: 0, environment: 0, action: 0, psychology: 0, total: 0 },
        narrationRatio: 0,
        dialogueRatio: 0
      },
      rhetoric: { metaphor: 0, personification: 0, parallelism: 0, rhetoricalQuestion: 0, hyperbole: 0, antithesis: 0, total: 0, perThousand: 0 },
      dialogueStyle: {
        dialogueRatio: 0,
        promptWordPreference: [],
        avgDialogueLength: 0,
        lengthDistribution: { short: 0, medium: 0, long: 0 }
      },
      paragraphStructure: {
        avgParagraphLength: 0,
        medianParagraphLength: 0,
        lengthDistribution: { short: 0, medium: 0, long: 0, veryLong: 0 },
        openingFeatures: { timeWord: 0, conjunction: 0, subject: 0, other: 0 }
      },
      overallStyle: { primaryStyle: "\u672A\u77E5", confidence: 0, styleScores: {} },
      stats: { totalChars: 0, totalSentences: 0, totalParagraphs: 0 }
    };
    const emptyFeatures = {
      rhythm: {
        sentenceLengthDistribution: { short: 0, medium: 0, long: 0 },
        avgSentenceLength: 0,
        shortSentenceRatio: 0,
        punctuationDensity: 0,
        paragraphDensity: 0,
        pauseFrequency: 0,
        description: "",
        samples: [],
        status: "pending"
      },
      sentencePattern: {
        inversionDensity: 0,
        ellipsisDensity: 0,
        parallelismDensity: 0,
        rhetoricalQuestionRatio: 0,
        clauseNestingDepth: 0,
        description: "",
        samples: [],
        status: "pending"
      },
      wordChoice: {
        commonWordRatio: 0,
        rareWordRatio: 0,
        functionWordRatio: 0,
        wordLengthDistribution: { len1: 0, len2: 0, len3: 0, len4plus: 0 },
        fourCharIdiomDensity: 0,
        description: "",
        samples: [],
        status: "pending"
      },
      rhetoric: {
        metaphorDensity: 0,
        personificationDensity: 0,
        hyperboleDensity: 0,
        parallelismDensity: 0,
        antithesisDensity: 0,
        synesthesiaDensity: 0,
        description: "",
        samples: [],
        status: "pending"
      },
      perspective: {
        personDistribution: { first: 0, second: 0, third: 0 },
        perspectiveSwitchFrequency: 0,
        narrativeDistance: { far: 0, medium: 0, near: 0 },
        description: "",
        samples: [],
        status: "pending"
      },
      emotion: {
        emotionalTone: "",
        emotionalFluctuationFrequency: 0,
        emotionalIntensityDistribution: { low: 0, medium: 0, high: 0 },
        valenceRatio: { positive: 0, negative: 0, neutral: 0 },
        description: "",
        samples: [],
        status: "pending"
      },
      tension: {
        suspenseDensity: 0,
        conflictFrequency: 0,
        turningPointDensity: 0,
        foreshadowingMarkerCount: 0,
        climaxDistribution: { early: 0, middle: 0, late: 0 },
        description: "",
        samples: [],
        status: "pending"
      },
      infoDensity: {
        infoDensity: 0,
        properNounDensity: 0,
        settingInjectionFrequency: 0,
        conceptIntroductionRhythm: 0,
        description: "",
        samples: [],
        status: "pending"
      },
      dialogue: {
        dialogueRatio: 0,
        dialogueStyleTag: "",
        personalizationLevel: 0,
        subtextRatio: 0,
        description: "",
        samples: [],
        status: "pending"
      },
      description: {
        environmentDescriptionRatio: 0,
        detailDensity: 0,
        sensoryDistribution: { visual: 0, auditory: 0, tactile: 0, olfactory: 0, gustatory: 0 },
        description: "",
        samples: [],
        status: "pending"
      },
      narration: {
        narrationSpeed: 0,
        timeJumpFrequency: 0,
        sceneSwitchFrequency: 0,
        description: "",
        samples: [],
        status: "pending"
      },
      languageTexture: {
        writtenLevel: 0,
        colloquialLevel: 0,
        archaismLevel: 0,
        regionalWordDensity: 0,
        description: "",
        samples: [],
        status: "pending"
      }
    };
    return {
      features: emptyFeatures,
      stats: { totalChars: 0, totalSentences: 0, totalParagraphs: 0 },
      v1Result: emptyV1
    };
  }
  splitParagraphs(text) {
    return text.split(/\r?\n\r?\n/).map((p) => p.trim()).filter((p) => p.length > 0);
  }
  splitSentences(text) {
    const sentences = [];
    const regex = /[^。！？…!?]+[。！？…!?]+/g;
    let match;
    while ((match = regex.exec(text)) !== null) {
      const s = match[0].trim();
      if (s.length > 0)
        sentences.push(s);
    }
    if (sentences.length === 0 && text.trim().length > 0) {
      sentences.push(text.trim());
    }
    return sentences;
  }
  extractDialogues(text) {
    const dialogues = [];
    const quotePairs = [
      { start: "\u300C", end: "\u300D" },
      { start: "\u300E", end: "\u300F" },
      { start: '"', end: '"' },
      { start: "\u201C", end: "\u201D" },
      { start: "\u2018", end: "\u2019" }
    ];
    for (const pair of quotePairs) {
      let startIdx = 0;
      while (startIdx < text.length) {
        const openIdx = text.indexOf(pair.start, startIdx);
        if (openIdx === -1)
          break;
        const closeIdx = text.indexOf(pair.end, openIdx + 1);
        if (closeIdx === -1)
          break;
        const content = text.slice(openIdx + 1, closeIdx);
        if (content.length > 0)
          dialogues.push(content);
        startIdx = closeIdx + 1;
      }
    }
    return dialogues;
  }
  detectParallelism(sentences) {
    let count = 0;
    for (let i = 0; i < sentences.length - 2; i++) {
      const start1 = sentences[i].slice(0, 2);
      const start2 = sentences[i + 1].slice(0, 2);
      const start3 = sentences[i + 2].slice(0, 2);
      if (start1 === start2 && start2 === start3 && this.isChineseChar(start1[0] || "")) {
        count++;
      }
    }
    return count;
  }
  countKeywords(text, keywordSet) {
    if (this._precomputedCounts && this._precomputedCounts.has(keywordSet)) {
      return this._precomputedCounts.get(keywordSet);
    }
    const singleCharSet = /* @__PURE__ */ new Set();
    const multiCharWords = [];
    for (const word of keywordSet) {
      if (word.length === 0)
        continue;
      if (word.length === 1)
        singleCharSet.add(word);
      else
        multiCharWords.push(word);
    }
    let count = 0;
    if (singleCharSet.size > 0) {
      for (let i = 0; i < text.length; i++) {
        if (singleCharSet.has(text[i]))
          count++;
      }
    }
    if (multiCharWords.length > 0) {
      let regex = this._regexCache.get(keywordSet);
      if (!regex) {
        multiCharWords.sort((a, b) => b.length - a.length);
        const pattern = multiCharWords.map((w) => this.escapeRegex(w)).join("|");
        regex = new RegExp(pattern, "g");
        this._regexCache.set(keywordSet, regex);
      }
      regex.lastIndex = 0;
      const matches = text.match(regex);
      if (matches)
        count += matches.length;
    }
    return count;
  }
  countKeywordsInText(text, keywordSet) {
    return this.countKeywords(text, keywordSet);
  }
  containsAny(text, keywordSet) {
    for (const word of keywordSet) {
      if (word.length === 0)
        continue;
      if (text.includes(word))
        return true;
    }
    return false;
  }
  countChineseChars(text) {
    if (text === this._cachedText && this._cachedChineseCharCount >= 0) {
      return this._cachedChineseCharCount;
    }
    let count = 0;
    for (let i = 0; i < text.length; i++) {
      if (this.isChineseChar(text[i]))
        count++;
    }
    this._cachedText = text;
    this._cachedChineseCharCount = count;
    return count;
  }
  isChineseChar(char) {
    if (!char)
      return false;
    const code = char.charCodeAt(0);
    return code >= 19968 && code <= 40959;
  }
  escapeRegex(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  perThousand(count, totalChars) {
    return this.round2(count / Math.max(totalChars, 1) * 1e3);
  }
  perHundred(count, totalChars) {
    return this.round2(count / Math.max(totalChars, 1) * 100);
  }
  truncateSample(text, minLen = 50, maxLen = 200) {
    const trimmed = text.trim();
    if (trimmed.length <= maxLen) {
      return trimmed;
    }
    return trimmed.slice(0, maxLen);
  }
  round2(n) {
    return Math.round(n * 100) / 100;
  }
  clamp01(v) {
    return Math.max(0, Math.min(1, v));
  }
};

// engine/style/style-worker.ts
var styleDeconstructor = null;
var styleDeconstructorV2 = null;
var vectorEnhancer = null;
function ensureDeconstructors() {
  if (!styleDeconstructor) {
    styleDeconstructor = new StyleDeconstructor(vectorEnhancer || void 0);
  }
  if (!styleDeconstructorV2) {
    styleDeconstructorV2 = new StyleDeconstructorV2(vectorEnhancer || void 0);
  }
}
registerTaskHandler("style:analyze", async (input, context) => {
  context.onProgress(0, "\u5F00\u59CB\u98CE\u683C\u5206\u6790");
  ensureDeconstructors();
  const result = styleDeconstructor.analyze(input.text);
  context.onProgress(100, "\u98CE\u683C\u5206\u6790\u5B8C\u6210");
  return result;
});
registerTaskHandler("style:analyze:vector", async (input, context) => {
  context.onProgress(0, "\u5F00\u59CB\u98CE\u683C\u5206\u6790\uFF08\u5411\u91CF\u589E\u5F3A\uFF09");
  ensureDeconstructors();
  const result = await styleDeconstructor.analyzeWithVector(input.text);
  context.onProgress(100, "\u98CE\u683C\u5206\u6790\u5B8C\u6210\uFF08\u5411\u91CF\u589E\u5F3A\uFF09");
  return result;
});
registerTaskHandler("style:analyze:v2", async (input, context) => {
  context.onProgress(0, "\u5F00\u59CB\u98CE\u683C\u5206\u6790 V2");
  ensureDeconstructors();
  const result = styleDeconstructorV2.analyze(input.text);
  context.onProgress(100, "\u98CE\u683C\u5206\u6790 V2 \u5B8C\u6210");
  return result;
});
startWorkerRuntime();
