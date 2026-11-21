// Build the executable parts of the npm package. Development still runs source.
import { chmod, copyFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import type { BunPlugin } from 'bun'

const root = resolve(import.meta.dir, '..')
const outdir = join(root, 'runtime')

// Collect notices for every dependency the bundler visits (a conservative
// superset of the code remaining after tree shaking), including OpenClaw.
function noticesPlugin(packages: Set<string>): BunPlugin {
  return {
    name: 'third-party-notices',
    setup(build) {
      build.onLoad({ filter: /[/\\]node_modules[/\\]/ }, args => {
        const normalized = args.path.replaceAll('\\', '/')
        const match = /^(.*\/node_modules\/(?:@[^/]+\/)?[^/]+)/.exec(normalized)
        if (match) packages.add(match[1]!)
        return undefined
      })
    }
  }
}

async function writeNotices(packages: Set<string>): Promise<void> {
  const entries: string[] = []
  for (const directory of [...packages].sort()) {
    const metadata = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8')) as {
      name: string
      version: string
      license?: string
    }
    const files = (await readdir(directory)).filter(name =>
      /^(licen[cs]e|notices?|copying|third[-_]party[-_]notices?)([._-].*)?$/i.test(name)
    )
    const notices = await Promise.all(files.map(file => readFile(join(directory, file), 'utf8')))
    entries.push(
      `${metadata.name}@${metadata.version} (${metadata.license ?? 'see upstream'})\n${notices.join('\n')}`
    )
  }
  await writeFile(
    join(outdir, 'third-party-notices.txt'),
    entries.join('\n\n--------------------\n\n')
  )
}

export async function buildPackage(): Promise<void> {
  await rm(outdir, { recursive: true, force: true })
  await mkdir(join(outdir, 'assets'), { recursive: true })
  const packages = new Set<string>()
  const devShell: BunPlugin = {
    name: 'dev-shell',
    setup(build) {
      // Production serves dist/. These imports exist only for Bun's dev server.
      build.onResolve({ filter: /\.html$/ }, () => ({ path: 'shell', namespace: 'dev-html' }))
      build.onLoad({ filter: /.*/, namespace: 'dev-html' }, () => ({
        contents: 'export default undefined',
        loader: 'js'
      }))
    }
  }
  const result = await Bun.build({
    entrypoints: [
      'server/cli.ts',
      'server/applets/build-worker-entry.ts',
      'server/applets/functions-worker.ts',
      'server/collab/worker.ts',
      'server/harness/openclaw/gateway-client.ts'
    ].map(path => join(root, path)),
    outdir,
    naming: { entry: '[name].js', chunk: 'chunk-[hash].js' },
    target: 'bun',
    splitting: true,
    minify: true,
    external: ['sharp', 'typescript', 'bun-plugin-tailwind', 'ws'],
    define: {
      MOI_BUNDLED: 'true'
    },
    plugins: [devShell, noticesPlugin(packages)]
  })
  if (!result.success) throw new AggregateError(result.logs, 'Server build failed')
  // The runtimes are inputs to future applet builds. Preserve their shared
  // bridge in one chunk; React remains supplied by the browser import map.
  await Bun.build({
    entrypoints: ['moi', 'rpc', 'collab', 'live'].map(name =>
      join(root, 'server/applets/runtime', name + '.ts')
    ),
    outdir: join(outdir, 'applets'),
    naming: { entry: '[name].js', chunk: 'chunk-[hash].js' },
    target: 'browser',
    splitting: true,
    minify: true,
    external: ['react', 'react-dom', 'react/jsx-runtime'],
    plugins: [noticesPlugin(packages)]
  })
  const styles = {
    'shadcn.css': Bun.resolveSync('shadcn/tailwind.css', root),
    'tw-animate.css': join(
      dirname(Bun.resolveSync('tw-animate-css/package.json', root)),
      'dist/tw-animate.css'
    )
  }
  for (const [name, path] of Object.entries(styles)) {
    await Bun.write(join(outdir, 'assets', name), Bun.file(path))
    let directory = dirname(path)
    while (!(await Bun.file(join(directory, 'package.json')).exists()))
      directory = dirname(directory)
    packages.add(directory)
  }
  // `open` locates this fallback beside its module on Linux. Keep its mode.
  const opener = join(dirname(Bun.resolveSync('open', root)), 'xdg-open')
  await copyFile(opener, join(outdir, 'xdg-open'))
  await chmod(join(outdir, 'xdg-open'), 0o755)
  await writeNotices(packages)
  console.log(`Built npm runtime (${result.outputs.length} executable files)`)
}

if (import.meta.main) await buildPackage()
