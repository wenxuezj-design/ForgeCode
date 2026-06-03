import { resolveInsideRoot } from "./path-policy.js";

export interface Workspace {
  rootPath: string;
  resolvePath(requestedPath: string): string;
}

export function createWorkspace(rootPath: string): Workspace {
  return {
    rootPath,
    resolvePath(requestedPath) {
      return resolveInsideRoot(rootPath, requestedPath);
    }
  };
}
