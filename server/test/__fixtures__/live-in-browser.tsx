import { channel } from 'moi/server'

const local = channel({})

export default function LiveInBrowser() {
  return <div>{local.connections}</div>
}
