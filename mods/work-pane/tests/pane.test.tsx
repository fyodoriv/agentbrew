import { expect, test } from 'claude-code/testing'

const PANE = {
  plugin: 'work-pane',
  component: 'Pane',
  requestId: 'work-pane',
  props: {
    title: 'Work day',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const

const STATUS = {
  title: 'Work day Mon Oct 26',
  rows: [
    { step: '/agentbrew', status: 'done', summary: 'synced', needsYou: '', link: '' },
    { step: '/tooling-checkup', status: 'blocked', summary: '', needsYou: 'approve the push', link: '' },
  ],
  questions: ['Send the draft reply?'],
}

test('the pane shows what needs you, then each step', async ($, on) => {
  on('command.register', () => ({ value: { command: 'work-pane' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('process.run', () => ({
    value: { exitCode: 0, stdout: JSON.stringify({ dashboard: { statusPath: '/s/work.json' } }), stderr: '' },
  }))
  on('fs.read', () => ({ value: JSON.stringify(STATUS) }))
  on('clock.every', () => ({ value: { cancel: () => {} } }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'work-pane', args: '' })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /approve the push/ }))?.text).toBe('• /tooling-checkup: approve the push')
  expect((await ui.find({ type: 'Text', text: /draft reply/ }))?.text).toBe('• Send the draft reply?')
  expect((await ui.find({ type: 'Text', text: /synced/ }))?.text).toBe('✓ /agentbrew synced')
  await ui.unmount()
})
