import { Link } from 'wouter'

import { LocalUserSettings } from './local-user-settings'
import { CollabPlayground } from './collab-playground'

export function CollabPage() {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-6 py-10">
      <div>
        <Link href="/dev" className="text-sm text-muted-foreground hover:text-foreground">
          ← Dev pages
        </Link>
        <header className="mt-5">
          <h1 className="text-xl font-medium">Collab</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Test collaboration in a workspace or try the presence playground.
          </p>
        </header>
      </div>
      <LocalUserSettings />
      <CollabPlayground />
    </main>
  )
}
