// Read and write in one sync step so no other module can change the file between them.
export function updateModel(path: string, model: string): void {
  const config = readConfig(path);
  config.model = model;
  writeConfig(path, config);
}
