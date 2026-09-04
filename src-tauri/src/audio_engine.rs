//! 原生音频采集、播放与设备管理

use std::{
    collections::{HashMap, VecDeque},
    sync::{mpsc as std_mpsc, Arc},
    thread::JoinHandle,
};

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use futures_util::StreamExt;
use livekit::{
    options::TrackPublishOptions,
    prelude::{LocalAudioTrack, Room, TrackSource},
    webrtc::{
        audio_frame::AudioFrame,
        audio_source::{native::NativeAudioSource, RtcAudioSource},
        audio_stream::native::NativeAudioStream,
    },
};
use parking_lot::Mutex;
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::sync::mpsc;

use crate::audio_processor::{InferenceBackend, NativeNoiseProcessor};

/// 输入或输出设备信息
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeAudioDevice {
    /// 设备唯一标识
    pub device_id: String,
    /// 设备名称
    pub label: String,
    /// 是否为当前系统默认设备
    pub is_default: bool,
}

/// 系统输入与输出设备列表
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeAudioDevices {
    /// 麦克风设备列表
    pub inputs: Vec<NativeAudioDevice>,
    /// 音频输出设备列表
    pub outputs: Vec<NativeAudioDevice>,
}

/// 原生音频处理偏好
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeAudioPreferences {
    /// 当前输入设备标识
    pub input_device_id: String,
    /// 当前输出设备标识
    pub output_device_id: String,
    /// 输入音量百分比
    pub input_volume: u16,
    /// 输出音量百分比
    pub output_volume: u16,
    /// 是否启用降噪
    pub noise_suppression: bool,
    /// 降噪强度
    pub noise_reduction_level: u8,
    /// 是否启用回声抵消
    pub echo_cancellation: bool,
}

/// 单个参与者在界面中的状态
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeParticipant {
    /// LiveKit 身份标识
    pub identity: String,
    /// 参与者昵称
    pub name: String,
    /// 是否正在发言
    pub speaking: bool,
    /// 是否关闭麦克风
    pub microphone_muted: bool,
    /// 是否关闭自己的输出
    pub output_muted: bool,
    /// 加入顺序
    pub order: i64,
}

/// 房间状态事件载荷
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeRoomState {
    /// 房间名称
    pub room_name: String,
    /// 当前连接状态
    pub connection_state: String,
    /// 房间参与者
    pub participants: Vec<NativeParticipant>,
    /// 当前客户端是否关闭麦克风
    pub microphone_muted: bool,
    /// 当前客户端是否关闭输出
    pub output_muted: bool,
    /// 当前网络往返延迟
    pub latency: Option<u32>,
    /// 当前使用的原生推理后端
    pub inference_backend: InferenceBackend,
}

/// 播放混音器状态
pub struct MixerState {
    /// 按身份保存远端音频队列
    streams: HashMap<String, VecDeque<f32>>,
    /// 按身份保存远端成员独立增益
    participant_gains: HashMap<String, f32>,
    /// 系统提示音队列，不受成员独立音量影响
    system: VecDeque<f32>,
    /// 是否关闭所有远端输出
    output_muted: bool,
    /// 全局输出增益
    output_gain: f32,
    /// 麦克风测试耳返队列
    monitor: VecDeque<f32>,
}

/// 原生音频混音器
pub type AudioMixer = Arc<Mutex<MixerState>>;

/// 原生采集处理过程中的可变音频设置
pub struct AudioRuntimeSettings {
    /// 麦克风输入增益
    pub input_gain: f32,
    /// 是否启用降噪
    pub noise_suppression: bool,
    /// 降噪强度
    pub noise_reduction_level: u8,
    /// 是否启用回声抵消
    pub echo_cancellation: bool,
}

/// 独立音频线程的控制句柄
///
/// cpal 的流在创建它的线程中保持到线程退出，避免 CoreAudio 的流对象进入 Tauri 状态
pub struct AudioThreadHandle {
    /// 用于控制音频线程切换设备或释放输入输出流
    command_sender: std_mpsc::Sender<AudioThreadCommand>,
    /// 保留线程句柄，便于保证线程资源拥有者的生命周期明确
    thread: Option<JoinHandle<()>>,
}

/// 独立音频线程支持的控制命令
enum AudioThreadCommand {
    /// 切换当前输入输出设备
    UpdateDevices {
        /// 新的输入设备标识
        input_device_id: String,
        /// 新的输出设备标识
        output_device_id: String,
        /// 将切换结果返回给调用线程
        result_sender: std_mpsc::SyncSender<Result<(), String>>,
    },
    /// 释放音频流并退出线程
    Shutdown,
}

impl AudioThreadHandle {
    /// 切换原生输入输出设备
    pub fn update_devices(
        &self,
        input_device_id: String,
        output_device_id: String,
    ) -> Result<(), String> {
        let (result_sender, result_receiver) = std_mpsc::sync_channel(1);
        self.command_sender
            .send(AudioThreadCommand::UpdateDevices {
                input_device_id,
                output_device_id,
                result_sender,
            })
            .map_err(|_| "原生音频线程已经退出".to_string())?;
        result_receiver
            .recv()
            .map_err(|_| "未收到音频设备切换结果".to_string())?
    }

    /// 通知音频线程退出并等待其释放 cpal 流
    pub fn shutdown(mut self) {
        let _ = self.command_sender.send(AudioThreadCommand::Shutdown);
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

/// 创建空的原生混音器
pub fn create_mixer(output_volume: u16) -> AudioMixer {
    Arc::new(Mutex::new(MixerState {
        streams: HashMap::new(),
        participant_gains: HashMap::new(),
        system: VecDeque::new(),
        output_muted: false,
        output_gain: f32::from(output_volume.min(300)) / 100.0,
        monitor: VecDeque::new(),
    }))
}

/// 枚举当前系统全部输入输出设备
pub fn list_audio_devices() -> Result<NativeAudioDevices, String> {
    let host = cpal::default_host();
    let default_input = host
        .default_input_device()
        .and_then(|device| device.name().ok());
    let default_output = host
        .default_output_device()
        .and_then(|device| device.name().ok());
    let inputs = host
        .input_devices()
        .map_err(|error| format!("读取麦克风设备失败: {error}"))?
        .filter_map(|device| device.name().ok())
        .map(|label| NativeAudioDevice {
            device_id: label.clone(),
            is_default: default_input.as_deref() == Some(label.as_str()),
            label,
        })
        .collect();
    let outputs = host
        .output_devices()
        .map_err(|error| format!("读取音频输出设备失败: {error}"))?
        .filter_map(|device| device.name().ok())
        .map(|label| NativeAudioDevice {
            device_id: label.clone(),
            is_default: default_output.as_deref() == Some(label.as_str()),
            label,
        })
        .collect();
    Ok(NativeAudioDevices { inputs, outputs })
}

/// 按设备名称寻找 cpal 设备，default 表示系统默认设备
fn find_device(input: bool, requested_id: &str) -> Result<cpal::Device, String> {
    let host = cpal::default_host();
    if requested_id == "default" || requested_id.is_empty() {
        return if input {
            host.default_input_device()
                .ok_or_else(|| "未检测到可用的麦克风".to_string())
        } else {
            host.default_output_device()
                .ok_or_else(|| "未检测到可用的音频输出设备".to_string())
        };
    }
    let devices = if input {
        host.input_devices()
    } else {
        host.output_devices()
    }
    .map_err(|error| format!("读取音频设备失败: {error}"))?;
    devices
        .into_iter()
        .find(|device| device.name().ok().as_deref() == Some(requested_id))
        .ok_or_else(|| format!("找不到音频设备: {requested_id}"))
}

/// 将输入采集回调中的样本按 10 毫秒切片发送到异步处理线程
fn push_input_frame(
    samples: &[f32],
    channels: usize,
    pending: &mut Vec<f32>,
    sender: &mpsc::Sender<Vec<f32>>,
    level: &AppHandle,
) {
    for chunk in samples.chunks(channels.max(1)) {
        pending.push(chunk.iter().copied().sum::<f32>() / chunk.len().max(1) as f32);
    }
    while pending.len() >= 480 {
        let frame: Vec<f32> = pending.drain(..480).collect();
        let rms =
            (frame.iter().map(|sample| sample * sample).sum::<f32>() / frame.len() as f32).sqrt();
        let _ = level.emit("voice://microphone-level", rms.min(1.0));
        let _ = sender.try_send(frame);
    }
}

/// 创建原生麦克风采集流
pub fn build_input_stream(
    device: &cpal::Device,
    sender: mpsc::Sender<Vec<f32>>,
    app: AppHandle,
) -> Result<(cpal::Stream, u32), String> {
    let supported = device
        .supported_input_configs()
        .map_err(|error| format!("读取麦克风配置失败: {error}"))?
        .find(|config| config.min_sample_rate().0 <= 48000 && config.max_sample_rate().0 >= 48000)
        .map(|config| config.with_sample_rate(cpal::SampleRate(48000)))
        .ok_or_else(|| "所选麦克风不支持 48000 Hz 采样率".to_string())?;
    let sample_rate = 48000;
    let channels = usize::from(supported.channels());
    let config: cpal::StreamConfig = supported.clone().into();
    let error_callback = |error| eprintln!("音频输入流错误: {error}");
    let stream = match supported.sample_format() {
        cpal::SampleFormat::F32 => {
            let mut pending = Vec::with_capacity(960);
            device.build_input_stream(
                &config,
                move |data: &[f32], _| {
                    push_input_frame(data, channels, &mut pending, &sender, &app)
                },
                error_callback,
                None,
            )
        }
        cpal::SampleFormat::I16 => {
            let mut pending = Vec::with_capacity(960);
            device.build_input_stream(
                &config,
                move |data: &[i16], _| {
                    let converted: Vec<f32> = data
                        .iter()
                        .map(|sample| f32::from(*sample) / 32768.0)
                        .collect();
                    push_input_frame(&converted, channels, &mut pending, &sender, &app);
                },
                error_callback,
                None,
            )
        }
        cpal::SampleFormat::U16 => {
            let mut pending = Vec::with_capacity(960);
            device.build_input_stream(
                &config,
                move |data: &[u16], _| {
                    let converted: Vec<f32> = data
                        .iter()
                        .map(|sample| f32::from(*sample) / 32768.0 - 1.0)
                        .collect();
                    push_input_frame(&converted, channels, &mut pending, &sender, &app);
                },
                error_callback,
                None,
            )
        }
        format => return Err(format!("不支持的麦克风采样格式: {format:?}")),
    }
    .map_err(|error| format!("创建麦克风采集流失败: {error}"))?;
    stream
        .play()
        .map_err(|error| format!("启动麦克风采集失败: {error}"))?;
    Ok((stream, sample_rate))
}

/// 从混音器中取出一帧远端声音并写入输出缓冲区
fn fill_output<T: cpal::Sample + cpal::FromSample<f32>>(
    output: &mut [T],
    channels: usize,
    mixer: &AudioMixer,
) {
    let mut state = mixer.lock();
    for frame in output.chunks_mut(channels.max(1)) {
        let mut sample = state.system.pop_front().unwrap_or(0.0);
        let identities: Vec<String> = state.streams.keys().cloned().collect();
        for identity in identities {
            let gain = state
                .participant_gains
                .get(&identity)
                .copied()
                .unwrap_or(1.0);
            if let Some(queue) = state.streams.get_mut(&identity) {
                sample += queue.pop_front().unwrap_or(0.0) * gain;
            }
        }
        if let Some(monitor_sample) = state.monitor.pop_front() {
            sample += monitor_sample;
        }
        let sample = if state.output_muted {
            0.0
        } else {
            (sample * state.output_gain).clamp(-1.0, 1.0)
        };
        for value in frame.iter_mut() {
            *value = T::from_sample(sample);
        }
    }
}

/// 创建原生扬声器播放流
pub fn build_output_stream(
    device: &cpal::Device,
    mixer: AudioMixer,
) -> Result<(cpal::Stream, u32), String> {
    let supported = device
        .default_output_config()
        .map_err(|error| format!("读取音频输出配置失败: {error}"))?;
    let sample_rate = supported.sample_rate().0;
    let channels = usize::from(supported.channels());
    let config: cpal::StreamConfig = supported.clone().into();
    let error_callback = |error| eprintln!("音频输出流错误: {error}");
    let stream = match supported.sample_format() {
        cpal::SampleFormat::F32 => device.build_output_stream(
            &config,
            move |data: &mut [f32], _| fill_output(data, channels, &mixer),
            error_callback,
            None,
        ),
        cpal::SampleFormat::I16 => device.build_output_stream(
            &config,
            move |data: &mut [i16], _| fill_output(data, channels, &mixer),
            error_callback,
            None,
        ),
        cpal::SampleFormat::U16 => device.build_output_stream(
            &config,
            move |data: &mut [u16], _| fill_output(data, channels, &mixer),
            error_callback,
            None,
        ),
        format => return Err(format!("不支持的音频输出采样格式: {format:?}")),
    }
    .map_err(|error| format!("创建音频输出流失败: {error}"))?;
    stream
        .play()
        .map_err(|error| format!("启动音频输出失败: {error}"))?;
    Ok((stream, sample_rate))
}

/// 在独立线程中创建并持有输入输出流
pub fn start_audio_thread(
    input_device_id: String,
    output_device_id: String,
    input_sender: mpsc::Sender<Vec<f32>>,
    mixer: AudioMixer,
    app: AppHandle,
) -> Result<(AudioThreadHandle, u32, u32), String> {
    let (ready_sender, ready_receiver) = std_mpsc::channel::<Result<(u32, u32), String>>();
    let (command_sender, command_receiver) = std_mpsc::channel::<AudioThreadCommand>();
    let thread = std::thread::Builder::new()
        .name("voice-room-audio".to_string())
        .spawn(move || {
            let result = (|| {
                let input_device = find_device(true, &input_device_id)?;
                let output_device = find_device(false, &output_device_id)?;
                let (mut output_stream, output_sample_rate) = build_output_stream(&output_device, mixer.clone())?;
                let (mut input_stream, input_sample_rate) = build_input_stream(&input_device, input_sender.clone(), app.clone())?;
                let mut active_input_device_id = input_device_id;
                let mut active_output_device_id = output_device_id;
                ready_sender
                    .clone()
                    .send(Ok((input_sample_rate, output_sample_rate)))
                    .map_err(|_| "音频线程初始化结果发送失败".to_string())?;
                while let Ok(command) = command_receiver.recv() {
                    match command {
                        AudioThreadCommand::UpdateDevices { input_device_id, output_device_id, result_sender } => {
                            let result = (|| {
                                if input_device_id != active_input_device_id {
                                    let device = find_device(true, &input_device_id)?;
                                    let (next_stream, sample_rate) = build_input_stream(&device, input_sender.clone(), app.clone())?;
                                    if sample_rate != 48000 {
                                        return Err(format!("当前麦克风采样率为 {sample_rate} Hz，原生降噪链路要求 48000 Hz"));
                                    }
                                    input_stream = next_stream;
                                    active_input_device_id = input_device_id;
                                }
                                if output_device_id != active_output_device_id {
                                    let device = find_device(false, &output_device_id)?;
                                    let (next_stream, _) = build_output_stream(&device, mixer.clone())?;
                                    output_stream = next_stream;
                                    active_output_device_id = output_device_id;
                                }
                                Ok(())
                            })();
                            let _ = result_sender.send(result);
                        }
                        AudioThreadCommand::Shutdown => break,
                    }
                }
                drop((input_stream, output_stream));
                Ok(())
            })();
            if let Err(error) = result {
                let _ = ready_sender.send(Err(error));
            }
        })
        .map_err(|error| format!("创建原生音频线程失败: {error}"))?;

    match ready_receiver.recv() {
        Ok(Ok((input_sample_rate, output_sample_rate))) => Ok((
            AudioThreadHandle {
                command_sender,
                thread: Some(thread),
            },
            input_sample_rate,
            output_sample_rate,
        )),
        Ok(Err(error)) => {
            let _ = command_sender.send(AudioThreadCommand::Shutdown);
            let _ = thread.join();
            Err(error)
        }
        Err(_) => {
            let _ = command_sender.send(AudioThreadCommand::Shutdown);
            let _ = thread.join();
            Err("原生音频线程未返回初始化结果".to_string())
        }
    }
}

/// 启动麦克风帧处理任务并将处理后的帧发布到 LiveKit
pub fn spawn_capture_task(
    mut receiver: mpsc::Receiver<Vec<f32>>,
    source: NativeAudioSource,
    settings: Arc<Mutex<AudioRuntimeSettings>>,
    preferences: &NativeAudioPreferences,
    app: AppHandle,
) -> Result<tokio::task::JoinHandle<()>, String> {
    let mut processor = NativeNoiseProcessor::new(
        preferences.noise_suppression,
        preferences.noise_reduction_level,
    )?;
    Ok(tokio::spawn(async move {
        while let Some(mut frame) = receiver.recv().await {
            let (input_gain, noise_suppression, noise_reduction_level) = {
                let runtime = settings.lock();
                (
                    runtime.input_gain,
                    runtime.noise_suppression,
                    runtime.noise_reduction_level,
                )
            };
            processor.update(Some(noise_suppression), Some(noise_reduction_level));
            for sample in &mut frame {
                *sample = (*sample * input_gain).clamp(-1.0, 1.0);
            }
            processor.process_frame(&mut frame);
            if source
                .capture_frame(&AudioFrame {
                    data: frame
                        .iter()
                        .map(|sample| (*sample * 32767.0) as i16)
                        .collect::<Vec<_>>()
                        .into(),
                    sample_rate: 48000,
                    num_channels: 1,
                    samples_per_channel: 480,
                })
                .await
                .is_err()
            {
                let _ = app.emit("voice://error", "麦克风音频发布失败");
                break;
            }
        }
    }))
}

/// 启动单个远端音轨的原生播放任务
pub fn spawn_remote_audio_task(
    identity: String,
    track: livekit::prelude::RemoteAudioTrack,
    sample_rate: u32,
    mixer: AudioMixer,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let mut stream = NativeAudioStream::new(track.rtc_track(), sample_rate as i32, 1);
        while let Some(frame) = stream.next().await {
            let mut state = mixer.lock();
            let queue = state.streams.entry(identity.clone()).or_default();
            queue.extend(frame.data.iter().map(|sample| f32::from(*sample) / 32768.0));
            let max_samples = sample_rate as usize * 2;
            while queue.len() > max_samples {
                queue.pop_front();
            }
        }
    })
}

/// 更新混音器的全局输出设置
pub fn update_output(mixer: &AudioMixer, muted: Option<bool>, volume: Option<u16>) {
    let mut state = mixer.lock();
    if let Some(muted) = muted {
        state.output_muted = muted;
    }
    if let Some(volume) = volume {
        state.output_gain = f32::from(volume.min(300)) / 100.0;
    }
}

/// 更新某个远端成员的本机独立音量
pub fn update_participant_volume(mixer: &AudioMixer, identity: &str, volume: u16) {
    let mut state = mixer.lock();
    state
        .participant_gains
        .insert(identity.to_string(), f32::from(volume.min(300)) / 100.0);
}

/// 从混音器移除已经离开房间的参与者
pub fn remove_participant(mixer: &AudioMixer, identity: &str) {
    let mut state = mixer.lock();
    state.streams.remove(identity);
    state.participant_gains.remove(identity);
}

/// 添加只受全局音量影响的房间提示音
pub fn add_system_tone(mixer: &AudioMixer, sample_rate: u32, joined: bool) {
    let frequencies = if joined {
        [523.25_f32, 659.25]
    } else {
        [659.25, 523.25]
    };
    let mut state = mixer.lock();
    for (index, frequency) in frequencies.into_iter().enumerate() {
        for n in 0..(sample_rate / 10) {
            let t = n as f32 / sample_rate as f32 + index as f32 / 10.0;
            let envelope = (1.0 - n as f32 / (sample_rate / 10) as f32).max(0.0);
            state
                .system
                .push_back((t * frequency * std::f32::consts::TAU).sin() * 0.06 * envelope);
        }
    }
}

/// 创建发布到房间的原生麦克风轨道
pub fn create_local_track(source: NativeAudioSource) -> LocalAudioTrack {
    LocalAudioTrack::create_audio_track("microphone", RtcAudioSource::Native(source))
}

/// 返回用于发布轨道的 LiveKit 选项
pub fn microphone_publish_options() -> TrackPublishOptions {
    TrackPublishOptions {
        source: TrackSource::Microphone,
        ..Default::default()
    }
}

/// 取得参与者的麦克风关闭状态
pub fn participant_microphone_muted(participant: &livekit::prelude::Participant) -> bool {
    participant
        .track_publications()
        .values()
        .find(|publication| publication.source() == TrackSource::Microphone)
        .map(|publication| publication.is_muted())
        .unwrap_or(true)
}

/// 将 LiveKit 参与者转换为前端状态
pub fn participant_snapshot(
    participant: &livekit::prelude::Participant,
    order: i64,
) -> NativeParticipant {
    let attributes = participant.attributes();
    NativeParticipant {
        identity: participant.identity().to_string(),
        name: participant.name(),
        speaking: participant.is_speaking(),
        microphone_muted: participant_microphone_muted(participant),
        output_muted: attributes
            .get("voice.outputMuted")
            .map(|value| value == "true")
            .unwrap_or(false),
        order,
    }
}

/// 根据房间当前参与者生成稳定的加入顺序快照
pub fn room_snapshot(
    room: &Room,
    room_name: &str,
    backend: InferenceBackend,
    latency: Option<u32>,
) -> NativeRoomState {
    let mut participants: Vec<livekit::prelude::Participant> =
        vec![livekit::prelude::Participant::Local(
            room.local_participant(),
        )];
    participants.extend(
        room.remote_participants()
            .into_values()
            .map(livekit::prelude::Participant::Remote),
    );
    participants.sort_by_key(|participant| participant.joined_at());
    let participants = participants
        .into_iter()
        .enumerate()
        .map(|(index, participant)| participant_snapshot(&participant, index as i64))
        .collect();
    let local = room.local_participant();
    NativeRoomState {
        room_name: room_name.to_string(),
        connection_state: format!("{:?}", room.connection_state()),
        participants,
        microphone_muted: participant_microphone_muted(&livekit::prelude::Participant::Local(
            local.clone(),
        )),
        output_muted: local
            .attributes()
            .get("voice.outputMuted")
            .map(|value| value == "true")
            .unwrap_or(false),
        latency,
        inference_backend: backend,
    }
}
