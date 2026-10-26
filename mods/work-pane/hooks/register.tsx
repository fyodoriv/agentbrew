import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { WorkStatusFile } from '../types'

const PANE = 'work-pane'
const POLL_MS = 5000
const statusPath = atom({ plugin: 'work-pane', key: 'statusPath' } as const, '')
const day = atom({ plugin: 'work-pane', key: 'day' } as const, null)

const MARK: Record<string, string> = { done: '✓', running: '…', waiting: '·', blocked: '!', failed: '✗' }

// Polling starts once per session; a reload starts it over.
let polling = false

async function openPane($: EngineInterface): Promise<string> {
  // The status file path comes from the plan, so the pane follows XDG_STATE_HOME and the date.
  const plan = await $.process.run(['agentbrew', 'work', '--json'])
  if (plan.exitCode !== 0) return 'agentbrew work --json failed; is agentbrew installed?'
  const path = (JSON.parse(plan.stdout) as { dashboard: { statusPath: string } }).dashboard.statusPath
  await update($, statusPath, () => path)
  const poll = async () => {
    try {
      const text = await $.fs.read(path)
      await update($, day, () => JSON.parse(text) as WorkStatusFile)
    } catch {
      // No status file yet: /work has not started today.
    }
  }
  await poll()
  if (!polling) {
    polling = true
    $.clock.every(POLL_MS, poll)
  }
  await $.ui.open({ id: PANE, title: 'Work day' })
  return `Work pane opened; it reads ${path}.`
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'work-pane', description: 'Show /work progress in a pane' })
    return next(e)
  })

  on('command.run', { command: 'work-pane' }, async $ => ({ text: await openPane($) }))

  // `/work` always opens the pane beside the chat.
  on('prompt.submit', async ($, e, next) => {
    if (e.command?.name === 'work') await openPane($)
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const today = await read($, day)
    if (!today) return <Text dimColor>No /work run today yet. Type /work to start.</Text>
    const needs = [...today.rows.filter(r => r.needsYou).map(r => `${r.step}: ${r.needsYou}`), ...today.questions]
    return (
      <Box flexDirection="column">
        <Text bold>{today.title}</Text>
        {needs.length > 0 && <Text bold>Needs you</Text>}
        {needs.map(line => (
          <Text>• {line}</Text>
        ))}
        <Text bold>Steps</Text>
        {today.rows.map(row => (
          <Text dimColor={row.status === 'done'}>
            {MARK[row.status] ?? '·'} {row.step} {row.summary}
          </Text>
        ))}
      </Box>
    )
  })
}
