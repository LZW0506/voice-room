import { spawn } from 'node:child_process'
import { access } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const platform = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : process.platform
const binaryName = process.platform === 'win32' ? 'voice-noise-helper.exe' : 'voice-noise-helper'
const resourceDir = join(root, 'native', 'resources', platform, process.arch)
const binaryPath = join(resourceDir, binaryName)
const modelPath = join(resourceDir, 'models', 'DeepFilterNet3_onnx.tar.gz')

/** 读取文件并在测试前确认构建资源存在 */
async function assertResource(path, label) {
  try {
    await access(path)
  } catch {
    throw new Error(`${label}不存在: ${path}，请先执行 yarn native:prepare`)
  }
}

/** 构造 48kHz 单声道测试帧，使用低幅度正弦波避免输入全静音短路 */
function createFrame(frameIndex) {
  const frame = Buffer.alloc(480 * 4)
  for (let index = 0; index < 480; index += 1) {
    const sample = Math.sin((frameIndex * 480 + index) * 2 * Math.PI * 440 / 48000) * 0.1
    frame.writeFloatLE(sample, index * 4)
  }
  return frame
}

/** 启动 helper 并验证 PCM 输出帧数与输入帧数一致 */
async function runTest() {
  await assertResource(binaryPath, '降噪 helper')
  await assertResource(modelPath, 'DeepFilterNet 模型')
  const child = spawn(binaryPath, ['--provider', 'onnx-cpu', '--model', modelPath, '--strength', '80'], {
    stdio: ['pipe', 'pipe', 'pipe']
  })
  const output = []
  let diagnostics = ''
  child.stdout.on('data', (chunk) => output.push(chunk))
  child.stderr.on('data', (chunk) => {
    diagnostics += chunk.toString()
  })
  for (let index = 0; index < 12; index += 1) child.stdin.write(createFrame(index))
  child.stdin.end()
  const exitCode = await new Promise((resolveExit) => child.once('close', resolveExit))
  if (exitCode !== 0) throw new Error(`helper 测试失败，退出码 ${exitCode}\n${diagnostics}`)
  const outputBytes = Buffer.concat(output).byteLength
  if (outputBytes !== 12 * 480 * 4) {
    throw new Error(`helper 输出帧数不正确，期望 ${12 * 480 * 4} 字节，实际 ${outputBytes} 字节\n${diagnostics}`)
  }
  const ready = diagnostics.includes('READY provider=onnx-cpu')
  if (!ready) throw new Error(`helper 未报告 READY\n${diagnostics}`)
  console.log(`helper 测试通过: ${outputBytes} bytes`)
}

await runTest()
