import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { zipSync } from 'fflate'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(scriptDir, '..')
const extensionRoot = join(projectRoot, 'extension')
const distRoot = join(projectRoot, 'dist')
const unpackedRoot = join(distRoot, 'unpacked')

async function collect(directory, root = directory, output = {}) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = join(directory, entry.name)
    if (entry.isDirectory()) await collect(absolute, root, output)
    else output[relative(root, absolute).replaceAll('\\', '/')] = new Uint8Array(await readFile(absolute))
  }
  return output
}

async function copyTree(directory, target, root = directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = join(directory, entry.name)
    const destination = join(target, relative(root, absolute))
    if (entry.isDirectory()) {
      await mkdir(destination, { recursive: true })
      await copyTree(absolute, target, root)
    } else {
      await mkdir(dirname(destination), { recursive: true })
      await writeFile(destination, await readFile(absolute))
    }
  }
}

await rm(distRoot, { recursive: true, force: true })
await mkdir(unpackedRoot, { recursive: true })
await copyTree(extensionRoot, unpackedRoot)
const files = await collect(extensionRoot)
const zip = zipSync(files, { level: 9 })
const archive = join(distRoot, 'mysql-browser-client.zip')
await writeFile(archive, zip)
console.log(`Extension unpacked: ${unpackedRoot}`)
console.log(`Extension archive: ${archive}`)
console.log(`Files: ${Object.keys(files).length}`)

