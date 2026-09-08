import { createHash } from 'node:crypto'
import { chmod, mkdir, readFile, writeFile, copyFile, access } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const exec = promisify(execFile)
const root = resolve(import.meta.dirname, '..')
const platform = process.platform
const arch = process.arch
const platformDir = platform === 'win32' ? 'windows' : platform === 'darwin' ? 'macos' : platform
const resourceDir = join(root, 'native', 'resources', platformDir, arch)
const modelUrl = 'https://raw.githubusercontent.com/Rikorose/DeepFilterNet/main/models/DeepFilterNet3_onnx.tar.gz'
const localModelPath = process.env.DEEPFILTER_MODEL_PATH
const proxyUrl = process.env.PROXY_URL || process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.ALL_PROXY
const modelPath = join(resourceDir, 'models', 'DeepFilterNet3_onnx.tar.gz')
const binaryName = platform === 'win32' ? 'voice-noise-helper.exe' : 'voice-noise-helper'
const binaryPath = join(resourceDir, binaryName)

/** 执行外部命令并保留构建失败信息 */
async function run(command, args, options = {}) {
  return exec(command, args, { cwd: root, stdio: 'inherit', ...options })
}

/** 下载并校验平台模型资源 */
async function prepareModel() {
  await mkdir(dirname(modelPath), { recursive: true })
  try {
    await access(modelPath)
    return
  } catch {
    // 模型不存在时由构建流程下载固定上游模型
  }
  if (localModelPath) {
    await copyFile(resolve(localModelPath), modelPath)
  } else if (proxyUrl) {
    await run('curl', ['--fail', '--location', '--silent', '--show-error', '--proxy', proxyUrl, '--output', modelPath, modelUrl])
  } else {
    const response = await fetch(modelUrl)
    if (!response.ok) throw new Error(`下载 DeepFilterNet 模型失败: ${response.status}`)
    const bytes = Buffer.from(await response.arrayBuffer())
    await writeFile(modelPath, bytes)
  }
  const bytes = await readFile(modelPath)
  const hash = createHash('sha256').update(bytes).digest('hex')
  console.log(`${localModelPath ? '已复制' : '已下载'} ${modelPath} sha256=${hash}`)
}

/** 构建当前宿主平台的原生 helper */
async function prepareHelper() {
  await run('cargo', ['build', '--release', '--manifest-path', join(root, 'native', 'noise-reduction', 'Cargo.toml')])
  const source = join(root, 'native', 'noise-reduction', 'target', 'release', binaryName)
  await copyFile(source, binaryPath)
  if (platform !== 'win32') await chmod(binaryPath, 0o755)
}

/** 写入构建资源清单，防止运行时误加载其他平台资源 */
async function writeManifest() {
  const model = await readFile(modelPath)
  const manifest = {
    platform: platformDir,
    arch,
    model: 'DeepFilterNet3_onnx.tar.gz',
    modelSha256: createHash('sha256').update(model).digest('hex'),
    helper: binaryName,
    providers: platform === 'win32' ? ['onnx-cpu'] : platform === 'darwin' ? ['onnx-cpu'] : []
  }
  await writeFile(join(resourceDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
}

await prepareModel()
await prepareHelper()
await writeManifest()
console.log(`原生降噪资源已准备: ${resourceDir}`)
