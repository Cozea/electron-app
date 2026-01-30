"use strict";
const electron = require("electron");
electron.contextBridge.exposeInMainWorld("electronAPI", {
  platform: process.platform,
  auth: {
    login: () => electron.ipcRenderer.invoke("auth:login"),
    logout: () => electron.ipcRenderer.invoke("auth:logout"),
    getSession: () => electron.ipcRenderer.invoke("auth:getSession"),
    refresh: () => electron.ipcRenderer.invoke("auth:refresh"),
    updateOrganizations: (organizations) => electron.ipcRenderer.invoke("auth:updateOrganizations", organizations),
    onSuccess: (callback) => {
      const handler = (_event, session) => callback(session);
      electron.ipcRenderer.on("auth:success", handler);
      return () => electron.ipcRenderer.removeListener("auth:success", handler);
    },
    onError: (callback) => {
      const handler = (_event, error) => callback(error);
      electron.ipcRenderer.on("auth:error", handler);
      return () => electron.ipcRenderer.removeListener("auth:error", handler);
    }
  },
  integrations: {
    isEncryptionAvailable: () => electron.ipcRenderer.invoke("integrations:isEncryptionAvailable"),
    generateKey: () => electron.ipcRenderer.invoke("integrations:generateKey"),
    storeKey: (options) => electron.ipcRenderer.invoke("integrations:storeKey", options),
    getKey: (options) => electron.ipcRenderer.invoke("integrations:getKey", options),
    deleteKey: (options) => electron.ipcRenderer.invoke("integrations:deleteKey", options),
    keyExists: (options) => electron.ipcRenderer.invoke("integrations:keyExists", options),
    encrypt: (options) => electron.ipcRenderer.invoke("integrations:encrypt", options),
    decrypt: (options) => electron.ipcRenderer.invoke("integrations:decrypt", options),
    onOAuthSuccess: (callback) => {
      const handler = (_event, data) => callback(data);
      electron.ipcRenderer.on("integrations:oauthSuccess", handler);
      return () => electron.ipcRenderer.removeListener("integrations:oauthSuccess", handler);
    },
    onOAuthError: (callback) => {
      const handler = (_event, data) => callback(data);
      electron.ipcRenderer.on("integrations:oauthError", handler);
      return () => electron.ipcRenderer.removeListener("integrations:oauthError", handler);
    },
    startOAuth: (options) => electron.ipcRenderer.invoke("integrations:startOAuth", options),
    runTool: (options) => electron.ipcRenderer.invoke("integrations:runTool", options),
    isToolAvailable: (options) => electron.ipcRenderer.invoke("integrations:isToolAvailable", options),
    getToolDefinition: (options) => electron.ipcRenderer.invoke("integrations:getToolDefinition", options),
    listTools: () => electron.ipcRenderer.invoke("integrations:listTools")
  },
  database: {
    supabaseSelect: (options) => electron.ipcRenderer.invoke("db:supabase:select", options),
    firestoreListDocuments: (options) => electron.ipcRenderer.invoke("db:firestore:listDocuments", options)
  },
  tools: {
    run: (request) => electron.ipcRenderer.invoke("tools:run", request)
  },
  shell: {
    openExternal: (url) => electron.ipcRenderer.invoke("shell:openExternal", url)
  },
  settings: {
    get: () => electron.ipcRenderer.invoke("settings:get"),
    set: (settings) => electron.ipcRenderer.invoke("settings:set", settings)
  },
  dialog: {
    selectDirectory: () => electron.ipcRenderer.invoke("dialog:selectDirectory")
  },
  storage: {
    getUsage: () => electron.ipcRenderer.invoke("storage:getUsage"),
    listProjects: () => electron.ipcRenderer.invoke("storage:listProjects")
  },
  window: {
    isFullScreen: () => electron.ipcRenderer.invoke("window:isFullScreen"),
    onFullScreenChange: (callback) => {
      const handler = (_event, isFullScreen) => callback(isFullScreen);
      electron.ipcRenderer.on("window:fullscreen-change", handler);
      return () => electron.ipcRenderer.removeListener("window:fullscreen-change", handler);
    }
  },
  preview: {
    injectBridge: (options) => electron.ipcRenderer.invoke("preview:injectBridge", options),
    captureScreenshot: (options) => electron.ipcRenderer.invoke("preview:captureScreenshot", options)
  },
  project: {
    createFolder: (options) => electron.ipcRenderer.invoke("project:createFolder", options),
    getLocalPath: (slug) => electron.ipcRenderer.invoke("project:getLocalPath", { slug }),
    exists: (slug) => electron.ipcRenderer.invoke("project:exists", { slug }),
    writeFile: (options) => electron.ipcRenderer.invoke("project:writeFile", options),
    readFile: (options) => electron.ipcRenderer.invoke("project:readFile", options),
    readFileBase64: (options) => electron.ipcRenderer.invoke("project:readFileBase64", options),
    listFiles: (options) => electron.ipcRenderer.invoke("project:listFiles", options),
    watchStart: (options) => electron.ipcRenderer.invoke("project:watchStart", options),
    watchStop: (options) => electron.ipcRenderer.invoke("project:watchStop", options)
  },
  fs: {
    readDir: (path) => electron.ipcRenderer.invoke("fs:readDir", path),
    readFile: (path) => electron.ipcRenderer.invoke("fs:readFile", path)
  },
  sync: {
    hashFile: (options) => electron.ipcRenderer.invoke("sync:hashFile", options),
    getLocalManifest: (options) => electron.ipcRenderer.invoke("sync:getLocalManifest", options),
    writeFiles: (options) => electron.ipcRenderer.invoke("sync:writeFiles", options),
    deleteFiles: (options) => electron.ipcRenderer.invoke("sync:deleteFiles", options)
  },
  yjs: {
    onExternalFileChange: (callback) => {
      const handler = (_event, data) => callback(data);
      electron.ipcRenderer.on("yjs:external-file-change", handler);
      return () => electron.ipcRenderer.removeListener("yjs:external-file-change", handler);
    },
    onExternalFileDelete: (callback) => {
      const handler = (_event, data) => callback(data);
      electron.ipcRenderer.on("yjs:external-file-delete", handler);
      return () => electron.ipcRenderer.removeListener("yjs:external-file-delete", handler);
    }
  },
  devServer: {
    start: (options) => electron.ipcRenderer.invoke("devServer:start", options),
    stop: (options) => electron.ipcRenderer.invoke("devServer:stop", options),
    resize: (options) => electron.ipcRenderer.invoke("devServer:resize", options),
    isRunning: (options) => electron.ipcRenderer.invoke("devServer:isRunning", options),
    onOutput: (callback) => {
      const handler = (_event, data) => callback(data);
      electron.ipcRenderer.on("devServer:output", handler);
      return () => electron.ipcRenderer.removeListener("devServer:output", handler);
    },
    onExit: (callback) => {
      const handler = (_event, data) => callback(data);
      electron.ipcRenderer.on("devServer:exit", handler);
      return () => electron.ipcRenderer.removeListener("devServer:exit", handler);
    },
    onError: (callback) => {
      const handler = (_event, data) => callback(data);
      electron.ipcRenderer.on("devServer:error", handler);
      return () => electron.ipcRenderer.removeListener("devServer:error", handler);
    }
  },
  terminal: {
    create: (options) => electron.ipcRenderer.invoke("terminal:create", options),
    input: (options) => electron.ipcRenderer.invoke("terminal:input", options),
    resize: (options) => electron.ipcRenderer.invoke("terminal:resize", options),
    kill: (options) => electron.ipcRenderer.invoke("terminal:kill", options),
    getProfiles: () => electron.ipcRenderer.invoke("terminal:getProfiles"),
    list: (options) => electron.ipcRenderer.invoke("terminal:list", options),
    getInfo: (options) => electron.ipcRenderer.invoke("terminal:getInfo", options),
    onOutput: (callback) => {
      const handler = (_event, data) => callback(data);
      electron.ipcRenderer.on("terminal:output", handler);
      return () => electron.ipcRenderer.removeListener("terminal:output", handler);
    },
    onExit: (callback) => {
      const handler = (_event, data) => callback(data);
      electron.ipcRenderer.on("terminal:exit", handler);
      return () => electron.ipcRenderer.removeListener("terminal:exit", handler);
    }
  }
});
