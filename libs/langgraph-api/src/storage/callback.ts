import { Callbacks } from "@langchain/core/callbacks/manager";
import path from "path";
import { pathToFileURL } from "url";

export const resolveCallbacks = async ({
  cwd,
  callbacks,
}: {
  cwd: string;
  callbacks?: { path: string };
}): Promise<Callbacks> => {
  const filePath = callbacks?.path;
  if (!filePath) return [];
  const sourceFile = path.resolve(cwd, filePath);
  return await import(pathToFileURL(sourceFile).toString()).then(
    (module) => module["default"],
  );
};

class GlobalCallbacks {
  constructor() {}
  private callbacks: Callbacks = [];
  async initialize(options: { cwd: string; callbacks?: { path: string } }) {
    this.callbacks = await resolveCallbacks(options);
  }
  get() {
    return this.callbacks;
  }
}

export const callbacks = new GlobalCallbacks();
