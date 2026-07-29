import { spawnSync } from "node:child_process"
import { readdir } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const testsRoot = path.join(projectRoot, "tests")

async function findTestFiles(directory) {
  const files = []
  const entries = await readdir(directory, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name)
    if (entry.isDirectory()) files.push(...await findTestFiles(fullPath))
    else if (entry.isFile() && /\.test\.(?:[cm]?[jt]sx?)$/.test(entry.name)) {
      files.push(path.relative(projectRoot, fullPath))
    }
  }
  return files.sort((left, right) => left.localeCompare(right, "en"))
}

const testFiles = await findTestFiles(testsRoot)
if (testFiles.length === 0) throw new Error(`No test files found under ${testsRoot}`)
const result = spawnSync(process.execPath, ["--import", "tsx", "--test", ...testFiles], {
  cwd: projectRoot,
  stdio: "inherit",
})
if (result.error) throw result.error
if (result.signal) throw new Error(`Test runner terminated by signal ${result.signal}`)
process.exit(result.status ?? 1)
