import path from "path";
import { pathToFileURL } from "url";

export const resolveCallbacks = async () => {
  const cwd = process.cwd();
  const filePath = process.env.CALLBACK_PATH;
  if (!filePath) return [];
  const sourceFile = path.resolve(cwd, filePath);
  const callbacks = await import(pathToFileURL(sourceFile).toString()).then(
    (module) => module["default"],
  );
  return callbacks as any[];
};
