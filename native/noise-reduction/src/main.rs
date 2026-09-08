use anyhow::{bail, Context, Result};
use deep_filter::{Complex32, DFState};
use flate2::read::GzDecoder;
use ini::Ini;
use ort::{session::{Session, SessionOutputs}, value::Tensor};
use std::collections::VecDeque;
use std::env;
use std::fs::File;
use std::io::{self, Read, Write};
use std::path::PathBuf;
use tar::Archive;

const SAMPLE_RATE: usize = 48_000;

/// 启动参数实体
struct Arguments {
    /// 推理 provider 标识
    provider: String,
    /// DeepFilterNet ONNX 模型包路径
    model: PathBuf,
    /// 降噪强度
    strength: f32,
}

/// 从模型包读取的 ONNX 文件集合
struct ModelFiles {
    /// 编码器 ONNX 字节
    enc: Vec<u8>,
    /// ERB 解码器 ONNX 字节
    erb_dec: Vec<u8>,
    /// Deep Filtering 解码器 ONNX 字节
    df_dec: Vec<u8>,
    /// DeepFilterNet 配置
    config: Ini,
}

/// ONNX Runtime 推理状态和 DeepFilterNet 时频状态
struct Denoiser {
    /// 编码器会话
    enc: Session,
    /// ERB 解码器会话
    erb_dec: Session,
    /// Deep Filtering 解码器会话
    df_dec: Session,
    /// 当前音频帧的时频分析状态
    state: DFState,
    /// 等待应用 ERB mask 的频谱队列
    rolling_y: VecDeque<Vec<Complex32>>,
    /// 用于 Deep Filtering 的原始频谱队列
    rolling_x: VecDeque<Vec<Complex32>>,
    /// 采样率
    sr: usize,
    /// 每个模型帧的采样数
    hop_size: usize,
    /// FFT 频点数
    n_freqs: usize,
    /// ERB 频带数量
    nb_erb: usize,
    /// Deep Filtering 频点数量
    nb_df: usize,
    /// Deep Filtering 阶数
    df_order: usize,
    /// 卷积前视帧数
    conv_lookahead: usize,
    /// Deep Filtering 前视帧数
    df_lookahead: usize,
    /// 特征归一化系数
    alpha: f32,
    /// 限制噪声衰减时混回原始信号的比例
    attenuation_mix: Option<f32>,
    /// 连续低能量帧计数
    skip_counter: usize,
}

/// 解析 helper 启动参数
fn parse_args() -> Result<Arguments> {
    let mut provider = String::new();
    let mut model = None;
    let mut strength = 80.0_f32;
    let mut args = env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--provider" => provider = args.next().context("缺少 --provider 参数")?,
            "--model" => model = Some(PathBuf::from(args.next().context("缺少 --model 参数")?)),
            "--strength" => {
                strength = args
                    .next()
                    .context("缺少 --strength 参数")?
                    .parse()
                    .context("--strength 必须是数字")?
            }
            "--help" => {
                println!("voice-noise-helper --provider onnx-cpu --model <model.tar.gz> --strength <0-100>");
                std::process::exit(0)
            }
            value => bail!("未知参数: {value}"),
        }
    }
    if provider != "onnx-cpu" {
        bail!("当前 helper 仅支持 ONNX Runtime CPU，provider={provider} 暂不可用")
    }
    let model = model.context("必须提供 --model 参数")?;
    if !model.is_file() {
        bail!("模型文件不存在: {}", model.display())
    }
    Ok(Arguments {
        provider,
        model,
        strength: strength.clamp(0.0, 100.0),
    })
}

/// 将降噪强度转换为 DeepFilterNet 的最大衰减限制
fn attenuation_limit(strength: f32) -> f32 {
    if strength <= 0.0 {
        0.0
    } else {
        (strength / 100.0 * 30.0).clamp(0.0, 30.0)
    }
}

/// 读取模型包中的 ONNX 文件和配置
fn read_model_files(model_path: &PathBuf) -> Result<ModelFiles> {
    let file = File::open(model_path).context("打开 DeepFilterNet ONNX 模型包失败")?;
    let mut archive = Archive::new(GzDecoder::new(file));
    let mut enc = Vec::new();
    let mut erb_dec = Vec::new();
    let mut df_dec = Vec::new();
    let mut config = None;
    for entry in archive.entries().context("读取 DeepFilterNet 模型包失败")? {
        let mut entry = entry.context("读取模型文件失败")?;
        let path = entry.path().context("读取模型文件名失败")?;
        if path.ends_with("enc.onnx") {
            entry.read_to_end(&mut enc)?;
        } else if path.ends_with("erb_dec.onnx") {
            entry.read_to_end(&mut erb_dec)?;
        } else if path.ends_with("df_dec.onnx") {
            entry.read_to_end(&mut df_dec)?;
        } else if path.ends_with("config.ini") {
            config = Some(Ini::read_from(&mut entry).context("读取 DeepFilterNet 配置失败")?);
        }
    }
    if enc.is_empty() || erb_dec.is_empty() || df_dec.is_empty() {
        bail!("模型包缺少 enc.onnx、erb_dec.onnx 或 df_dec.onnx")
    }
    Ok(ModelFiles {
        enc,
        erb_dec,
        df_dec,
        config: config.context("模型包缺少 config.ini")?,
    })
}

/// 从 DeepFilterNet 配置读取整数参数
fn config_usize(section: &ini::Properties, key: &str) -> Result<usize> {
    section
        .get(key)
        .with_context(|| format!("DeepFilterNet 配置缺少 {key}"))?
        .parse()
        .with_context(|| format!("DeepFilterNet 配置 {key} 不是数字"))
}

/// 从 DeepFilterNet 配置读取浮点参数
fn config_f32(section: &ini::Properties, key: &str) -> Result<f32> {
    section
        .get(key)
        .with_context(|| format!("DeepFilterNet 配置缺少 {key}"))?
        .parse()
        .with_context(|| format!("DeepFilterNet 配置 {key} 不是数字"))
}

/// 从 ONNX 输出中复制指定名称的张量
fn output_tensor(outputs: &SessionOutputs<'_>, name: &str) -> Result<(Vec<i64>, Vec<f32>)> {
    let value = outputs
        .get(name)
        .with_context(|| format!("ONNX 输出缺少 {name}"))?;
    let (shape, data) = value
        .try_extract_tensor::<f32>()
        .with_context(|| format!("读取 ONNX 输出 {name} 失败"))?;
    Ok((shape.to_vec(), data.to_vec()))
}

/// 计算特征归一化系数
fn calculate_alpha(sr: usize, hop_size: usize, section: &ini::Properties) -> Result<f32> {
    if let Some(value) = section.get("norm_alpha") {
        return value.parse().context("DeepFilterNet 配置 norm_alpha 不是数字");
    }
    let tau = config_f32(section, "norm_tau")?;
    Ok((-((hop_size as f32 / sr as f32) / tau)).exp())
}

/// 创建 ONNX Runtime CPU 推理状态
fn create_denoiser(model: ModelFiles, strength: f32) -> Result<Denoiser> {
    let ModelFiles {
        enc: enc_model,
        erb_dec: erb_dec_model,
        df_dec: df_dec_model,
        config,
    } = model;
    let model_section = config
        .section(Some("deepfilternet"))
        .context("DeepFilterNet 配置缺少 deepfilternet 段")?;
    let df_section = config
        .section(Some("df"))
        .context("DeepFilterNet 配置缺少 df 段")?;
    let sr = config_usize(df_section, "sr")?;
    let hop_size = config_usize(df_section, "hop_size")?;
    let fft_size = config_usize(df_section, "fft_size")?;
    let min_nb_erb_freqs = config_usize(df_section, "min_nb_erb_freqs")?;
    let nb_erb = config_usize(df_section, "nb_erb")?;
    let nb_df = config_usize(df_section, "nb_df")?;
    let df_order: usize = df_section
        .get("df_order")
        .or_else(|| model_section.get("df_order"))
        .context("DeepFilterNet 配置缺少 df_order")?
        .parse()
        .context("DeepFilterNet 配置 df_order 不是数字")?;
    let conv_lookahead = config_usize(model_section, "conv_lookahead")?;
    let df_lookahead = df_section
        .get("df_lookahead")
        .or_else(|| model_section.get("df_lookahead"))
        .context("DeepFilterNet 配置缺少 df_lookahead")?
        .parse()
        .context("DeepFilterNet 配置 df_lookahead 不是数字")?;
    if sr != SAMPLE_RATE {
        bail!("模型采样率不是 48000Hz: {sr}")
    }
    let alpha = calculate_alpha(sr, hop_size, df_section)?;
    let attenuation = attenuation_limit(strength);
    let attenuation_mix = if attenuation >= 100.0 {
        None
    } else if attenuation < 0.01 {
        Some(1.0)
    } else {
        Some(10_f32.powf(-attenuation / 20.0))
    };

    // 只注册 CPU provider，确保 macOS 和 Windows 的 CPU 方案行为一致
    let _ = ort::init()
        .with_name("voice-noise-helper")
        .with_telemetry(false)
        .with_execution_providers([ort::ep::CPU::default().build()])
        .commit();
    let enc = Session::builder()?
        .commit_from_memory(&enc_model)
        .context("加载 ONNX Runtime 编码器失败")?;
    let erb_dec = Session::builder()?
        .commit_from_memory(&erb_dec_model)
        .context("加载 ONNX Runtime ERB 解码器失败")?;
    let df_dec = Session::builder()?
        .commit_from_memory(&df_dec_model)
        .context("加载 ONNX Runtime DF 解码器失败")?;
    let mut state = DFState::new(sr, fft_size, hop_size, nb_erb, min_nb_erb_freqs);
    state.init_norm_states(nb_df);
    let n_freqs = fft_size / 2 + 1;
    let lookahead = conv_lookahead.max(df_lookahead);
    let mut rolling_y = VecDeque::with_capacity(df_order + conv_lookahead);
    for _ in 0..(df_order + conv_lookahead) {
        rolling_y.push_back(vec![Complex32::default(); n_freqs]);
    }
    let mut rolling_x = VecDeque::with_capacity(df_order.max(lookahead));
    for _ in 0..df_order.max(lookahead) {
        rolling_x.push_back(vec![Complex32::default(); n_freqs]);
    }
    Ok(Denoiser {
        enc,
        erb_dec,
        df_dec,
        state,
        rolling_y,
        rolling_x,
        sr,
        hop_size,
        n_freqs,
        nb_erb,
        nb_df,
        df_order,
        conv_lookahead,
        df_lookahead,
        alpha,
        attenuation_mix,
        skip_counter: 0,
    })
}

impl Denoiser {
    /// 使用 ONNX Runtime 执行编码器推理
    fn run_encoder(&mut self, spec: &[Complex32]) -> Result<EncoderOutputs> {
        let mut erb = vec![0.0_f32; self.nb_erb];
        self.state.feat_erb(spec, self.alpha, &mut erb);
        let mut complex = vec![Complex32::default(); self.nb_df];
        self.state.feat_cplx(&spec[..self.nb_df], self.alpha, &mut complex);
        let mut feat_spec = Vec::with_capacity(self.nb_df * 2);
        feat_spec.extend(complex.iter().map(|value| value.re));
        feat_spec.extend(complex.iter().map(|value| value.im));
        let outputs = self.enc.run(vec![
            ("feat_erb", Tensor::from_array((vec![1_i64, 1, 1, self.nb_erb as i64], erb))?),
            ("feat_spec", Tensor::from_array((vec![1_i64, 2, 1, self.nb_df as i64], feat_spec))?),
        ])?;
        Ok(EncoderOutputs {
            e0: output_tensor(&outputs, "e0")?,
            e1: output_tensor(&outputs, "e1")?,
            e2: output_tensor(&outputs, "e2")?,
            e3: output_tensor(&outputs, "e3")?,
            emb: output_tensor(&outputs, "emb")?,
            c0: output_tensor(&outputs, "c0")?,
            lsnr: output_tensor(&outputs, "lsnr")?,
        })
    }

    /// 使用 ONNX Runtime 执行 ERB mask 和 DF 系数推理
    fn run_decoders(&mut self, encoded: EncoderOutputs) -> Result<(Vec<f32>, Vec<f32>, f32)> {
        let lsnr = *encoded
            .lsnr
            .1
            .first()
            .context("ONNX lsnr 输出为空")?;
        let erb_outputs = self.erb_dec.run(vec![
            ("emb", Tensor::from_array(encoded.emb.clone())?),
            ("e3", Tensor::from_array(encoded.e3.clone())?),
            ("e2", Tensor::from_array(encoded.e2.clone())?),
            ("e1", Tensor::from_array(encoded.e1.clone())?),
            ("e0", Tensor::from_array(encoded.e0.clone())?),
        ])?;
        let mask = output_tensor(&erb_outputs, "m")?.1;
        let df_outputs = self.df_dec.run(vec![
            ("emb", Tensor::from_array(encoded.emb)?),
            ("c0", Tensor::from_array(encoded.c0)?),
        ])?;
        let coefs = output_tensor(&df_outputs, "coefs")?.1;
        Ok((mask, coefs, lsnr))
    }

    /// 将模型输出的 DF 系数应用到频谱历史帧
    fn apply_deep_filter(&self, target: &mut [Complex32], coefs: &[f32]) -> Result<()> {
        let expected = self.nb_df * self.df_order * 2;
        if coefs.len() < expected {
            bail!("ONNX coefs 输出长度不足，期望至少 {expected}，实际 {}", coefs.len())
        }
        for frequency in 0..self.nb_df {
            let mut filtered = Complex32::default();
            for order in 0..self.df_order {
                let index = (frequency * self.df_order + order) * 2;
                let coefficient = Complex32::new(coefs[index], coefs[index + 1]);
                filtered += self.rolling_x[order][frequency] * coefficient;
            }
            target[frequency] = filtered;
        }
        Ok(())
    }

    /// 处理一帧 48kHz 单声道 Float32 PCM
    fn process_frame(&mut self, noisy: &[f32]) -> Result<Vec<f32>> {
        let max_amplitude = noisy.iter().map(|sample| sample.abs()).fold(0.0, f32::max);
        let rms = noisy.iter().map(|sample| sample * sample).sum::<f32>() / noisy.len() as f32;
        if rms < 1e-7 {
            self.skip_counter += 1;
        } else {
            self.skip_counter = 0;
        }
        if self.skip_counter > 5 {
            return Ok(vec![0.0; noisy.len()]);
        }
        if max_amplitude > 0.9999 {
            eprintln!("WARNING possible clipping detected: {max_amplitude:.3}");
        }
        self.rolling_y.pop_front();
        self.rolling_x.pop_front();
        let mut noisy_spec = vec![Complex32::default(); self.n_freqs];
        self.state.analysis(noisy, &mut noisy_spec);
        self.rolling_y.push_back(noisy_spec.clone());
        self.rolling_x.push_back(noisy_spec.clone());
        if self.attenuation_mix == Some(1.0) {
            return Ok(noisy.to_vec());
        }

        let encoded = self.run_encoder(&noisy_spec)?;
        let (mask, coefs, lsnr) = self.run_decoders(encoded)?;
        let (apply_mask, zero_mask, apply_df) = if lsnr < -10.0 {
            (false, true, false)
        } else if lsnr > 30.0 {
            (false, false, false)
        } else if lsnr > 20.0 {
            (true, false, false)
        } else {
            (true, false, true)
        };
        let target_index = self.df_order - 1;
        let target = self
            .rolling_y
            .get_mut(target_index)
            .context("DeepFilterNet 频谱队列长度错误")?;
        if zero_mask {
            target.fill(Complex32::default());
        } else if apply_mask {
            if mask.len() < self.nb_erb {
                bail!("ONNX mask 输出长度不足")
            }
            self.state.apply_mask(target, &mask[..self.nb_erb]);
        }
        let mut enhanced = target.clone();
        if apply_df {
            self.apply_deep_filter(&mut enhanced, &coefs)?;
        }
        let noisy_index = self
            .df_order
            .max(self.conv_lookahead.max(self.df_lookahead))
            .saturating_sub(self.conv_lookahead.max(self.df_lookahead) + 1);
        let noisy_reference = self
            .rolling_x
            .get(noisy_index)
            .context("DeepFilterNet 原始频谱队列长度错误")?;
        if let Some(mix) = self.attenuation_mix {
            for (output, reference) in enhanced.iter_mut().zip(noisy_reference) {
                *output = *output * (1.0 - mix) + *reference * mix;
            }
        }
        let mut output = vec![0.0_f32; self.hop_size];
        self.state.synthesis(&mut enhanced, &mut output);
        Ok(output)
    }
}

/// 编码器输出张量集合
struct EncoderOutputs {
    /// 编码器跳跃连接输出
    e0: (Vec<i64>, Vec<f32>),
    /// 编码器跳跃连接输出
    e1: (Vec<i64>, Vec<f32>),
    /// 编码器跳跃连接输出
    e2: (Vec<i64>, Vec<f32>),
    /// 编码器跳跃连接输出
    e3: (Vec<i64>, Vec<f32>),
    /// 编码器 embedding 输出
    emb: (Vec<i64>, Vec<f32>),
    /// 编码器 DF 特征输出
    c0: (Vec<i64>, Vec<f32>),
    /// 局部信噪比输出
    lsnr: (Vec<i64>, Vec<f32>),
}

/// 读取固定长度 Float32 PCM 帧
fn read_frame(input: &mut impl Read, frame_len: usize, buffer: &mut [u8]) -> io::Result<bool> {
    match input.read_exact(&mut buffer[..frame_len * 4]) {
        Ok(()) => Ok(true),
        Err(error) if error.kind() == io::ErrorKind::UnexpectedEof => Ok(false),
        Err(error) => Err(error),
    }
}

/// 运行标准输入输出 PCM helper
fn run(arguments: Arguments) -> Result<()> {
    let model = read_model_files(&arguments.model)?;
    let mut denoiser = create_denoiser(model, arguments.strength)?;
    if denoiser.sr != SAMPLE_RATE || denoiser.hop_size != 480 {
        bail!("当前音频链路要求模型为 48kHz、480 samples 帧，实际为 {}Hz、{} samples", denoiser.sr, denoiser.hop_size)
    }
    let mut input = io::stdin().lock();
    let mut output = io::BufWriter::new(io::stdout().lock());
    let mut bytes = vec![0_u8; denoiser.hop_size * 4];
    let mut samples = vec![0_f32; denoiser.hop_size];
    eprintln!(
        "READY provider={} sample_rate={} frame_samples={}",
        arguments.provider, denoiser.sr, denoiser.hop_size
    );
    while read_frame(&mut input, denoiser.hop_size, &mut bytes)? {
        for (index, sample) in samples.iter_mut().enumerate() {
            let offset = index * 4;
            *sample = f32::from_le_bytes(bytes[offset..offset + 4].try_into().unwrap());
        }
        let enhanced = denoiser.process_frame(&samples)?;
        for sample in enhanced {
            output.write_all(&sample.to_le_bytes())?;
        }
        output.flush()?;
    }
    Ok(())
}

/// helper 主入口
fn main() {
    let result = (|| -> Result<()> {
        let arguments = parse_args()?;
        run(arguments)
    })();
    if let Err(error) = result {
        eprintln!("ERROR {error:#}");
        std::process::exit(1);
    }
}
