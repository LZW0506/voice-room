import { copyFile, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** 将 DeepFilterNet3 模型复制到 Rust 编译期嵌入所需的静态资源目录 */
async function copyDeepFilterModel() {
  const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const sourcePath = resolve(
    projectRoot,
    'node_modules/deepfilternet3-assets/models/DeepFilterNet3_onnx.tar.gz',
  )
  const targetPath = resolve(
    projectRoot,
    'public/deepfilter/v3/models/DeepFilterNet3_onnx.tar.gz',
  )

  await mkdir(dirname(targetPath), { recursive: true })
  await copyFile(sourcePath, targetPath)
}

await copyDeepFilterModel()
