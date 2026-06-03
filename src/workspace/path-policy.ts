import { relative, resolve } from "node:path";

export function resolveInsideRoot(rootPath: string, requestedPath: string): string {
  const root = resolve(rootPath);
  const target = resolve(root, requestedPath);
  const relativePath = relative(root, target);

  if (relativePath === ".." || relativePath.startsWith(`..${"/"}`) || relativePath.startsWith(`..${"\\"}`) || resolve(relativePath) === relativePath) {
    throw new Error(`Path is outside the workspace: ${requestedPath}`);
  }

  return target;
}
