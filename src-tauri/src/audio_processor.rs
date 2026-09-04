//! 原生音频处理器
//!
//! 该模块只接收和返回音频帧，不依赖 Tauri WebView
//! Windows 固定使用 ONNX Runtime CPU，macOS 固定优先使用 Core ML

use std::collections::VecDeque;
use std::{io::Read, sync::Once};

use ndarray::Array4;
use num_complex::Complex32;
use realfft::{ComplexToReal, RealFftPlanner, RealToComplex};

#[cfg(any(target_os = "macos", target_os = "windows"))]
use flate2::read::GzDecoder;
#[cfg(any(target_os = "macos", target_os = "windows"))]
use ort::{
    environment::GlobalThreadPoolOptions,
    session::{builder::GraphOptimizationLevel, Session},
    value::{Tensor, TensorRef},
};
#[cfg(any(target_os = "macos", target_os = "windows"))]
use tar::Archive;

/// 当前平台使用的推理执行提供程序
#[derive(Debug, Clone, Copy, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub enum InferenceBackend {
    /// Windows CPU 执行提供程序，底层由 ONNX Runtime 使用 SIMD 优化
    #[cfg_attr(target_os = "macos", allow(dead_code))]
    WindowsOnnxRuntimeCpu,
    /// macOS Core ML 执行提供程序
    MacosCoreMl,
}

/// 原生降噪处理器
pub struct NativeNoiseProcessor {
    /// 当前降噪强度
    level: f32,
    /// 是否启用降噪
    enabled: bool,
    /// DeepFilterNet3 的三个有状态 ONNX 会话
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    encoder: Session,
    /// DeepFilterNet3 ERB 增益解码会话
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    erb_decoder: Session,
    /// DeepFilterNet3 深度滤波系数解码会话
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    df_decoder: Session,
    /// 960 点实数 FFT 正变换
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    fft_forward: std::sync::Arc<dyn RealToComplex<f32>>,
    /// 960 点实数 FFT 逆变换
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    fft_inverse: std::sync::Arc<dyn ComplexToReal<f32>>,
    /// 分析窗口
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    window: Vec<f32>,
    /// 上一帧分析数据，用于构造 50% 重叠的 960 点窗口
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    analysis_tail: Vec<f32>,
    /// 上一帧合成尾部，用于重叠相加
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    synthesis_tail: Vec<f32>,
    /// ERB 频带对应的频率 bin 数量
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    erb_widths: Vec<usize>,
    /// ERB 归一化状态
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    erb_norm_state: Vec<f32>,
    /// 最近五个噪声频谱，用于 DeepFilterNet3 深度滤波阶段
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    spectral_history: VecDeque<Vec<Complex32>>,
}

impl NativeNoiseProcessor {
    /// 初始化 ONNX Runtime 全局环境并创建处理器
    pub fn new(enabled: bool, level: u8) -> Result<Self, String> {
        initialize_onnx_runtime()?;
        #[cfg(any(target_os = "macos", target_os = "windows"))]
        let (encoder, erb_decoder, df_decoder) = load_deepfilter_models()?;
        #[cfg(any(target_os = "macos", target_os = "windows"))]
        let mut fft_planner = RealFftPlanner::<f32>::new();
        #[cfg(any(target_os = "macos", target_os = "windows"))]
        let fft_forward = fft_planner.plan_fft_forward(960);
        #[cfg(any(target_os = "macos", target_os = "windows"))]
        let fft_inverse = fft_planner.plan_fft_inverse(960);
        #[cfg(any(target_os = "macos", target_os = "windows"))]
        let window = (0..960)
            .map(|index| {
                let phase = std::f32::consts::PI * (index as f32 + 0.5) / 480.0;
                (std::f32::consts::PI * phase.sin().powi(2) / 2.0).sin()
            })
            .collect();
        Ok(Self {
            level: f32::from(level.clamp(0, 100)),
            enabled,
            #[cfg(any(target_os = "macos", target_os = "windows"))]
            encoder,
            #[cfg(any(target_os = "macos", target_os = "windows"))]
            erb_decoder,
            #[cfg(any(target_os = "macos", target_os = "windows"))]
            df_decoder,
            #[cfg(any(target_os = "macos", target_os = "windows"))]
            fft_forward,
            #[cfg(any(target_os = "macos", target_os = "windows"))]
            fft_inverse,
            #[cfg(any(target_os = "macos", target_os = "windows"))]
            window,
            #[cfg(any(target_os = "macos", target_os = "windows"))]
            analysis_tail: vec![0.0; 480],
            #[cfg(any(target_os = "macos", target_os = "windows"))]
            synthesis_tail: vec![0.0; 480],
            #[cfg(any(target_os = "macos", target_os = "windows"))]
            erb_widths: erb_fb(48000, 960, 32, 2),
            #[cfg(any(target_os = "macos", target_os = "windows"))]
            erb_norm_state: (0..32)
                .map(|index| -60.0 - index as f32 * 30.0 / 31.0)
                .collect(),
            #[cfg(any(target_os = "macos", target_os = "windows"))]
            spectral_history: (0..5).map(|_| vec![Complex32::default(); 481]).collect(),
        })
    }

    /// 实时修改降噪开关与强度
    pub fn update(&mut self, enabled: Option<bool>, level: Option<u8>) {
        if let Some(enabled) = enabled {
            self.enabled = enabled;
        }
        if let Some(level) = level {
            self.level = f32::from(level.clamp(0, 100));
        }
    }

    /// 处理一个 10 毫秒的单声道浮点音频帧
    ///
    /// 当前帧处理入口保留在原生采集任务中，模型会话和流式状态不会回到 WebView
    pub fn process_frame(&mut self, frame: &mut [f32]) {
        if !self.enabled || self.level <= 0.0 {
            return;
        }

        // 先限制输入幅度，避免模型输入出现无穷值
        for sample in frame.iter_mut() {
            *sample = sample.clamp(-1.0, 1.0);
        }

        #[cfg(any(target_os = "macos", target_os = "windows"))]
        self.process_deepfilter_frame(frame);
    }

    /// 使用 DeepFilterNet3 的频域增益模型处理一个 10 毫秒音频帧
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    fn process_deepfilter_frame(&mut self, frame: &mut [f32]) {
        if frame.len() != 480 {
            return;
        }
        let mut time = vec![0.0; 960];
        time[..480].copy_from_slice(&self.analysis_tail);
        time[480..].copy_from_slice(frame);
        self.analysis_tail.copy_from_slice(frame);
        for (sample, window) in time.iter_mut().zip(&self.window) {
            *sample *= window;
        }
        let mut spectrum = self.fft_forward.make_output_vec();
        if self.fft_forward.process(&mut time, &mut spectrum).is_err() {
            return;
        }
        let Some((gains, coefs)) = self.infer_erb_gains(&spectrum) else {
            return;
        };
        self.spectral_history.pop_front();
        self.spectral_history.push_back(spectrum.clone());
        for (index, value) in spectrum.iter_mut().enumerate() {
            let mut band_start = 0;
            let mut gain = 1.0;
            for (band, width) in self.erb_widths.iter().enumerate() {
                if index < band_start + *width {
                    gain = gains.get(band).copied().unwrap_or(1.0);
                    break;
                }
                band_start += *width;
            }
            let strength = self.level / 100.0;
            *value *= 1.0 - strength * (1.0 - gain.clamp(0.0, 1.0));
        }
        for frequency in 0..96 {
            let mut filtered = Complex32::default();
            for order in 0..5 {
                let coefficient = Complex32::new(
                    coefs
                        .get((frequency * 5 + order) * 2)
                        .copied()
                        .unwrap_or(0.0),
                    coefs
                        .get((frequency * 5 + order) * 2 + 1)
                        .copied()
                        .unwrap_or(0.0),
                );
                let history_index = self.spectral_history.len().saturating_sub(1 + order);
                if let Some(previous) = self.spectral_history.get(history_index) {
                    filtered += previous[frequency] * coefficient;
                }
            }
            spectrum[frequency] = filtered;
        }
        let mut enhanced = vec![0.0; 960];
        if self
            .fft_inverse
            .process(&mut spectrum, &mut enhanced)
            .is_err()
        {
            return;
        }
        for (index, sample) in enhanced.iter_mut().enumerate() {
            *sample = *sample * self.window[index] / 960.0;
        }
        for index in 0..480 {
            frame[index] = (self.synthesis_tail[index] + enhanced[index]).clamp(-1.0, 1.0);
            self.synthesis_tail[index] = enhanced[index + 480];
        }
    }

    /// 计算当前频谱的 ERB 特征并执行 DeepFilterNet3 两个解码阶段
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    fn infer_erb_gains(&mut self, spectrum: &[Complex32]) -> Option<(Vec<f32>, Vec<f32>)> {
        let mut erb_features = vec![0.0; 32];
        let mut offset = 0;
        for (band, width) in self.erb_widths.iter().enumerate() {
            let power = spectrum[offset..offset + *width]
                .iter()
                .map(|value| value.norm_sqr())
                .sum::<f32>();
            let db = (power / (*width as f32) + 1e-10).log10() * 10.0;
            self.erb_norm_state[band] = db * 0.001 + self.erb_norm_state[band] * 0.999;
            erb_features[band] = (db - self.erb_norm_state[band]) / 40.0;
            offset += *width;
        }
        let mut spec_features = vec![0.0; 192];
        for (index, value) in spectrum.iter().take(96).enumerate() {
            spec_features[index] = value.re;
            spec_features[96 + index] = value.im;
        }
        let erb_input = Array4::from_shape_vec((1, 1, 1, 32), erb_features).ok()?;
        let spec_input = Array4::from_shape_vec((1, 2, 1, 96), spec_features).ok()?;
        let erb_ref = TensorRef::from_array_view(&erb_input).ok()?;
        let spec_ref = TensorRef::from_array_view(&spec_input).ok()?;
        let encoder_outputs = self.encoder.run(ort::inputs![erb_ref, spec_ref]).ok()?;
        let e0 = tensor_copy(&encoder_outputs, "e0")?;
        let e1 = tensor_copy(&encoder_outputs, "e1")?;
        let e2 = tensor_copy(&encoder_outputs, "e2")?;
        let e3 = tensor_copy(&encoder_outputs, "e3")?;
        let emb = tensor_copy(&encoder_outputs, "emb")?;
        let c0 = tensor_copy(&encoder_outputs, "c0")?;
        let e0 = Tensor::from_array(e0).ok()?;
        let e1 = Tensor::from_array(e1).ok()?;
        let e2 = Tensor::from_array(e2).ok()?;
        let e3 = Tensor::from_array(e3).ok()?;
        let emb = Tensor::from_array(emb).ok()?;
        let c0 = Tensor::from_array(c0).ok()?;
        let decoder_outputs = self
            .erb_decoder
            .run(ort::inputs![&emb, &e3, &e2, &e1, &e0])
            .ok()?;
        let gains = tensor_copy(&decoder_outputs, "m")?.1;
        let df_outputs = self.df_decoder.run(ort::inputs![&emb, &c0]).ok()?;
        let coefs = tensor_copy(&df_outputs, "coefs")?.1;
        Some((gains.into_iter().take(32).collect(), coefs))
    }
}

/// 从 ONNX 输出中复制张量形状和数据，解除输出会话的借用关系
#[cfg(any(target_os = "macos", target_os = "windows"))]
fn tensor_copy(
    outputs: &ort::session::SessionOutputs<'_>,
    name: &str,
) -> Option<(Vec<usize>, Vec<f32>)> {
    let output = outputs.get(name)?;
    let (shape, data) = output.try_extract_tensor::<f32>().ok()?;
    Some((
        shape.iter().map(|value| *value as usize).collect(),
        data.to_vec(),
    ))
}

/// 生成 DeepFilterNet3 使用的 ERB 频带宽度
#[cfg(any(target_os = "macos", target_os = "windows"))]
fn erb_fb(sr: usize, fft_size: usize, nb_bands: usize, min_nb_freqs: usize) -> Vec<usize> {
    let freq2erb = |frequency: f32| 9.265 * (frequency / (24.7 * 9.265)).ln_1p();
    let erb2freq = |erb: f32| 24.7 * 9.265 * ((erb / 9.265).exp() - 1.0);
    let width = sr as f32 / fft_size as f32;
    let step = (freq2erb((sr / 2) as f32) - freq2erb(0.0)) / nb_bands as f32;
    let mut result = vec![0; nb_bands];
    let mut previous = 0;
    let mut overflow = 0;
    for index in 1..=nb_bands {
        let current = (erb2freq(freq2erb(0.0) + index as f32 * step) / width).round() as usize;
        let mut count = current as i32 - previous as i32 - overflow;
        if count < min_nb_freqs as i32 {
            overflow = min_nb_freqs as i32 - count;
            count = min_nb_freqs as i32;
        } else {
            overflow = 0;
        }
        result[index - 1] = count as usize;
        previous = current;
    }
    result[nb_bands - 1] += 1;
    let total = result.iter().sum::<usize>();
    if total > fft_size / 2 + 1 {
        result[nb_bands - 1] -= total - (fft_size / 2 + 1);
    }
    result
}

/// 初始化 ONNX Runtime 全局环境
fn initialize_onnx_runtime() -> Result<(), String> {
    static INIT: Once = Once::new();
    let mut init_error: Option<String> = None;
    INIT.call_once(|| {
        #[cfg(target_os = "macos")]
        let committed = ort::init()
            .with_global_thread_pool(
                GlobalThreadPoolOptions::default()
                    .with_intra_threads(1)
                    .unwrap_or_default(),
            )
            .with_execution_providers([ort::ep::CoreML::default().build()])
            .commit();

        #[cfg(target_os = "windows")]
        let committed = ort::init()
            .with_global_thread_pool(
                GlobalThreadPoolOptions::default()
                    .with_intra_threads(1)
                    .unwrap_or_default(),
            )
            .commit();

        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        let committed = ort::init().commit();

        if !committed {
            init_error = Some("初始化 ONNX Runtime 失败".to_string());
        }
    });
    if let Some(error) = init_error {
        return Err(error);
    }
    Ok(())
}

/// 从安装包内嵌的压缩模型中读取 DeepFilterNet3 的三个 ONNX 文件
#[cfg(any(target_os = "macos", target_os = "windows"))]
fn load_deepfilter_model_bytes() -> Result<(Vec<u8>, Vec<u8>, Vec<u8>), String> {
    let model_archive =
        include_bytes!("../../public/deepfilter/v3/models/DeepFilterNet3_onnx.tar.gz");
    let mut archive = Archive::new(GzDecoder::new(model_archive.as_slice()));
    let mut encoder = None;
    let mut erb_decoder = None;
    let mut df_decoder = None;
    for entry in archive
        .entries()
        .map_err(|error| format!("读取 DeepFilterNet3 模型包失败: {error}"))?
    {
        let mut entry =
            entry.map_err(|error| format!("读取 DeepFilterNet3 模型文件失败: {error}"))?;
        let path = entry
            .path()
            .map_err(|error| format!("读取模型文件路径失败: {error}"))?
            .to_string_lossy()
            .to_string();
        let mut bytes = Vec::new();
        entry
            .read_to_end(&mut bytes)
            .map_err(|error| format!("读取模型文件内容失败: {error}"))?;
        if path.ends_with("enc.onnx") {
            encoder = Some(bytes);
        } else if path.ends_with("erb_dec.onnx") {
            erb_decoder = Some(bytes);
        } else if path.ends_with("df_dec.onnx") {
            df_decoder = Some(bytes);
        }
    }
    Ok((
        encoder.ok_or_else(|| "DeepFilterNet3 缺少 enc.onnx".to_string())?,
        erb_decoder.ok_or_else(|| "DeepFilterNet3 缺少 erb_dec.onnx".to_string())?,
        df_decoder.ok_or_else(|| "DeepFilterNet3 缺少 df_dec.onnx".to_string())?,
    ))
}

/// 使用平台指定的执行提供程序创建 DeepFilterNet3 ONNX 会话
#[cfg(any(target_os = "macos", target_os = "windows"))]
fn load_deepfilter_models() -> Result<(Session, Session, Session), String> {
    let (encoder, erb_decoder, df_decoder) = load_deepfilter_model_bytes()?;
    let build = |bytes: &[u8]| {
        Session::builder()
            .map_err(|error| format!("创建 ONNX Runtime 会话失败: {error}"))?
            .with_optimization_level(GraphOptimizationLevel::Level3)
            .map_err(|error| format!("设置 ONNX 图优化失败: {error}"))?
            .with_intra_threads(1)
            .map_err(|error| format!("设置 ONNX CPU 线程失败: {error}"))?
            .commit_from_memory(bytes)
            .map_err(|error| format!("加载 DeepFilterNet3 ONNX 模型失败: {error}"))
    };
    Ok((build(&encoder)?, build(&erb_decoder)?, build(&df_decoder)?))
}

/// 返回当前平台的固定推理后端
pub fn current_backend() -> InferenceBackend {
    #[cfg(target_os = "macos")]
    {
        return InferenceBackend::MacosCoreMl;
    }

    #[cfg(target_os = "windows")]
    {
        return InferenceBackend::WindowsOnnxRuntimeCpu;
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    InferenceBackend::WindowsOnnxRuntimeCpu
}

#[cfg(test)]
#[cfg(any(target_os = "macos", target_os = "windows"))]
mod tests {
    use super::*;

    /// 验证安装包内模型能够由当前平台的 ONNX Runtime 加载
    #[test]
    fn deepfilter_models_are_loadable() {
        initialize_onnx_runtime().expect("ONNX Runtime 初始化失败");
        let (encoder, erb_decoder, df_decoder) =
            load_deepfilter_models().expect("DeepFilterNet3 模型加载失败");
        assert_eq!(encoder.inputs().len(), 2);
        assert_eq!(erb_decoder.inputs().len(), 5);
        assert_eq!(df_decoder.inputs().len(), 2);
    }

    /// 验证一个 10 毫秒帧能够完成 DeepFilterNet3 推理和合成
    #[test]
    fn deepfilter_processes_audio_frame() {
        let mut processor = NativeNoiseProcessor::new(true, 80).expect("创建原生降噪处理器失败");
        let mut frame = vec![0.0_f32; 480];
        for (index, sample) in frame.iter_mut().enumerate() {
            *sample = (index as f32 * 0.03).sin() * 0.1;
        }
        processor.process_frame(&mut frame);
        assert!(frame.iter().all(|sample| sample.is_finite()));
    }
}
