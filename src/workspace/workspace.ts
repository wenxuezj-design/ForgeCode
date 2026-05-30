export interface Workspace {
  rootPath: string;
}

export function createWorkspace(rootPath: string): Workspace {
  return {
    rootPath
  };
}
