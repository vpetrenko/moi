import { parse, stringify } from 'devalue'

import { APPLET_API_BASE_SENTINEL } from '../api-base'

export function rpc(module: string, name: string) {
  const call = async (...args: unknown[]): Promise<unknown> => {
    const res = await fetch(APPLET_API_BASE_SENTINEL + '/rpc/' + module + '/' + name, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: stringify(args)
    })
    if (!res.ok) throw new Error(await res.text())
    return parse(await res.text())
  }
  // Names the server export; a synced state (`moi/sync`) matches its events by it.
  return Object.assign(call, { key: module + '/' + name })
}
