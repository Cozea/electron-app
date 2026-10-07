import type { LocalProjectsElectronAPI } from "@shared/localProjectTypes";

export function requireLocalProjectsApi(): LocalProjectsElectronAPI {
  const projects = window.electronAPI?.workspace?.projects;
  if (!projects)
    throw new Error("Local project storage is unavailable. Restart Cozea before trying again.");
  return projects;
}
