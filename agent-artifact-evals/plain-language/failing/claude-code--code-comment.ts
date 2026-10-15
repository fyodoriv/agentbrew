// This function updates the model.
// It reads the config file first.
// Then it sets the model key.
// Then it writes the file back.
// We do this synchronously on purpose.
export function updateModel(path: string, model: string): void {
  writeConfig(path, { ...readConfig(path), model });
}
