import { systemPreferences, type IpcMain } from "electron";

export function registerMediaHandlers(ipcMain: IpcMain): void {
  ipcMain.handle("media:getMicrophonePermission", () => {
    if (process.platform === "darwin" || process.platform === "win32") {
      try {
        return systemPreferences.getMediaAccessStatus("microphone");
      } catch {
        return "not-determined";
      }
    }
    return "granted";
  });

  ipcMain.handle("media:requestMicrophonePermission", async () => {
    if (process.platform === "darwin") {
      try {
        const current = systemPreferences.getMediaAccessStatus("microphone");
        if (current === "granted") return true;
        return await systemPreferences.askForMediaAccess("microphone");
      } catch {
        return false;
      }
    }
    return true;
  });
}
