export type WorkRow = { step: string; status: string; summary: string; needsYou: string; link: string }
export type WorkStatusFile = { title: string; rows: WorkRow[]; questions: string[] }

declare module 'claude-code' {
  interface PluginState {
    'work-pane': { statusPath: string; day: WorkStatusFile | null }
  }
}
