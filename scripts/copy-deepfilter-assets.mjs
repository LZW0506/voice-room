import { copyFile, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** 将 DeepFilterNet3 模型与 WASM 文件复制到 Vite 静态资源目录 */
async function copyDeepFilterAssets() {
  const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const assetRoot = resolve(projectRoot, 'node_modules/deepfilternet3-assets')
  const targetRoot = resolve(projectRoot, 'public/deepfilter/v3')
  const files = [
    ['pkg/df_bg.wasm', 'pkg/df_bg.wasm'],
    ['models/DeepFilterNet3_onnx.tar.gz', 'models/DeepFilterNet3_onnx.tar.gz'],
    ['LICENSE-MIT', 'LICENSE-MIT'],
    ['LICENSE-APACHE', 'LICENSE-APACHE'],
  ]

  await Promise.all(files.map(async ([source, target]) => {
    const targetPath = resolve(targetRoot, target)
    await mkdir(dirname(targetPath), { recursive: true })
    await copyFile(resolve(assetRoot, source), targetPath)
  }))
}

await copyDeepFilterAssets()
