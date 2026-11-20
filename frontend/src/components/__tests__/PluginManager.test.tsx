import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PluginManager } from '../PluginManager'

const api = vi.hoisted(() => ({
  getPlugins: vi.fn(),
  getVersionInfo: vi.fn(),
  installPlugin: vi.fn(),
  installPluginFromFile: vi.fn(),
  uninstallPlugin: vi.fn(),
  reloadPlugins: vi.fn(),
}))

vi.mock('../../api/client', () => api)

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <PluginManager />
    </QueryClientProvider>,
  )
}

const ITEM = {
  source_id: 'demo_source',
  display_name: 'Demo source',
  group: 'demo',
  needs_internet: false,
  file: 'demo_source.py',
  size: 2048,
  layer_count: 2,
  installed: false,
  installed_sha: null as string | null,
  update_available: false,
  local_modified: false,
}

describe('PluginManager', () => {
  beforeEach(() => {
    api.getVersionInfo.mockResolvedValue({ version: '2.4.0', frozen: true, data_dir: '', plugins_dir: 'C:/plugins' })
    api.installPlugin.mockResolvedValue({ ok: true, source_id: 'demo_source', installed_sha: 'x' })
    api.uninstallPlugin.mockResolvedValue({ ok: true, source_id: 'demo_source' })
    api.reloadPlugins.mockResolvedValue({ ok: true, source_ids: ['demo_source'] })
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('首次安装必须确认，并展示权限警告', async () => {
    api.getPlugins.mockResolvedValue({ ok: true, offline: false, plugins: [ITEM], registry_url: '' })
    mount()

    // 用整串匹配：「从本地文件安装」也含「安装」二字，宽松正则会点错按钮
    fireEvent.click(await screen.findByRole('button', { name: /^(安装|Install)$/ }))
    expect(screen.getByText(/安装前确认|Before installing/)).toBeTruthy()
    expect(screen.getByText(/读取你的全部日历数据|read all of your calendar data/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /确认安装|Install anyway/ }))
    await waitFor(() => expect(api.installPlugin).toHaveBeenCalled())
    expect(api.installPlugin.mock.calls[0][0]).toBe('demo_source')
  })

  it('卸载需要二次确认', async () => {
    api.getPlugins.mockResolvedValue({
      ok: true,
      offline: false,
      plugins: [{ ...ITEM, installed: true, installed_sha: 'abc' }],
      registry_url: '',
    })
    mount()

    fireEvent.click(await screen.findByTitle(/卸载|Uninstall/))
    expect(api.uninstallPlugin).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /确认卸载|Confirm/ }))
    await waitFor(() => expect(api.uninstallPlugin).toHaveBeenCalled())
    expect(api.uninstallPlugin.mock.calls[0][0]).toBe('demo_source')
  })

  it('离线且无缓存时给出提示', async () => {
    api.getPlugins.mockResolvedValue({ ok: false, offline: true, plugins: [], registry_url: '' })
    mount()
    expect(await screen.findByText(/无法连接插件源|Cannot reach the plugin registry/)).toBeTruthy()
  })
})
