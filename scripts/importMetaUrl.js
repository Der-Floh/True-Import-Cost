function moduleUrl() {
    return require('node:url').pathToFileURL(__filename).href;
}

export const importMetaUrl = /* @__PURE__ */ moduleUrl();
