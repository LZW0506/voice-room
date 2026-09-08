/** 创建原生降噪 AudioWorklet 模块 URL */
export function createNoiseProcessorUrl(): string {
  const source = `
    class VoiceNoiseProcessor extends AudioWorkletProcessor {
      constructor() {
        super()
        this.inputFrame = new Float32Array(480)
        this.inputOffset = 0
        this.outputFrames = []
        this.outputOffset = 0
        this.nativePort = null
        this.port.onmessage = (event) => {
          if (event.data?.type === 'connect') {
            this.nativePort = event.data.port
            this.nativePort.onmessage = (response) => {
              if (response.data instanceof ArrayBuffer) this.outputFrames.push(new Float32Array(response.data))
              if (response.data?.type === 'error') this.port.postMessage(response.data)
            }
            this.nativePort.start()
          }
        }
      }

      process(inputs, outputs) {
        const input = inputs[0]?.[0]
        const output = outputs[0]?.[0]
        if (!input || !output) return true
        for (let index = 0; index < input.length; index += 1) {
          this.inputFrame[this.inputOffset] = input[index]
          this.inputOffset += 1
          if (this.inputOffset === 480) {
            const frame = this.inputFrame.slice()
            if (this.nativePort) this.nativePort.postMessage(frame.buffer, [frame.buffer])
            this.inputOffset = 0
          }
        }
        output.fill(0)
        let outputOffset = 0
        while (outputOffset < output.length && this.outputFrames.length > 0) {
          const frame = this.outputFrames[0]
          const available = frame.length - this.outputOffset
          const count = Math.min(available, output.length - outputOffset)
          output.set(frame.subarray(this.outputOffset, this.outputOffset + count), outputOffset)
          outputOffset += count
          this.outputOffset += count
          if (this.outputOffset === frame.length) {
            this.outputFrames.shift()
            this.outputOffset = 0
          }
        }
        return true
      }
    }
    registerProcessor('voice-noise-processor', VoiceNoiseProcessor)
  `
  return URL.createObjectURL(new Blob([source], { type: 'application/javascript' }))
}

/** 创建并连接原生降噪 AudioWorklet 节点 */
export async function createNoiseProcessor(context: AudioContext, port: MessagePort): Promise<AudioWorkletNode> {
  const url = createNoiseProcessorUrl()
  try {
    await context.audioWorklet.addModule(url)
  } finally {
    URL.revokeObjectURL(url)
  }
  const node = new AudioWorkletNode(context, 'voice-noise-processor', { channelCount: 1 })
  node.port.postMessage({ type: 'connect', port }, [port])
  return node
}
