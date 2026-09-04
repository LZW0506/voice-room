//! 原生 LiveKit 房间引擎

use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicU32, Ordering},
        Arc,
    },
    time::Duration,
};

use livekit::{
    prelude::{LocalAudioTrack, LocalTrack, RemoteTrack, Room, RoomEvent},
    webrtc::audio_source::{native::NativeAudioSource, AudioSourceOptions},
};
use parking_lot::Mutex;
use tauri::{AppHandle, Emitter, State};
use tokio::{sync::mpsc, task::JoinHandle};

use crate::audio_engine::{
    self, AudioMixer, AudioRuntimeSettings, AudioThreadHandle, NativeAudioDevices,
    NativeAudioPreferences,
};
use crate::audio_processor::{current_backend, InferenceBackend};

/// Token 服务默认地址
const TOKEN_URL: &str = "http://82.157.174.249:8787/api/token";
/// LiveKit 默认地址
const LIVEKIT_URL: &str = "ws://82.157.174.249:7880";

/// 前端发起加入房间时的参数
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JoinRoomRequest {
    /// 房间名称
    pub room_name: String,
    /// LiveKit 身份
    pub identity: String,
    /// 参与者昵称
    pub display_name: String,
    /// 音频偏好
    pub preferences: NativeAudioPreferences,
}

/// Token 服务响应
#[derive(Debug, serde::Deserialize)]
struct TokenResponse {
    /// LiveKit 访问令牌
    token: String,
    /// LiveKit 服务地址
    url: Option<String>,
}

/// 当前房间引擎会话
pub struct NativeRoomSession {
    /// LiveKit 房间对象
    pub room: Arc<Room>,
    /// 当前本地麦克风轨道
    pub microphone_track: LocalAudioTrack,
    /// 原生混音器
    pub mixer: AudioMixer,
    /// 独立音频线程及其输入输出流
    pub audio_thread: AudioThreadHandle,
    /// 可实时更新的采集处理参数
    pub audio_settings: Arc<Mutex<AudioRuntimeSettings>>,
    /// 当前选择的输入设备标识
    pub input_device_id: String,
    /// 当前选择的输出设备标识
    pub output_device_id: String,
    /// 输入处理任务
    pub input_task: JoinHandle<()>,
    /// 房间事件任务
    pub event_task: JoinHandle<()>,
    /// 网络延迟采样任务
    pub latency_task: JoinHandle<()>,
    /// 远端音频任务
    pub remote_tasks: Arc<Mutex<HashMap<String, JoinHandle<()>>>>,
    /// 使用的推理后端
    pub inference_backend: InferenceBackend,
    /// 房间名称
    pub room_name: String,
    /// 输出采样率
    pub output_sample_rate: u32,
}

/// Tauri 全局状态
pub struct NativeAppState {
    /// 当前原生房间会话
    pub session: tokio::sync::Mutex<Option<NativeRoomSession>>,
}

impl Default for NativeAppState {
    /// 创建空的原生房间状态
    fn default() -> Self {
        Self {
            session: tokio::sync::Mutex::new(None),
        }
    }
}

/// 请求 Token 服务获取 LiveKit 访问令牌
async fn fetch_token(request: &JoinRoomRequest) -> Result<TokenResponse, String> {
    let response = reqwest::Client::new()
        .post(TOKEN_URL)
        .json(&serde_json::json!({ "room": request.room_name, "identity": request.identity, "name": request.display_name }))
        .send()
        .await
        .map_err(|error| format!("无法连接 Token 服务: {error}"))?;
    if !response.status().is_success() {
        return Err(format!("Token 服务返回错误: {}", response.status()));
    }
    response
        .json::<TokenResponse>()
        .await
        .map_err(|error| format!("解析 Token 服务响应失败: {error}"))
}

/// 枚举原生输入输出设备
#[tauri::command]
pub fn native_list_audio_devices() -> Result<NativeAudioDevices, String> {
    audio_engine::list_audio_devices()
}

/// 返回原生处理器当前平台策略
#[tauri::command]
pub fn native_audio_backend() -> Result<InferenceBackend, String> {
    Ok(current_backend())
}

/// 关闭现有原生房间会话
async fn close_session(session: NativeRoomSession) {
    session.input_task.abort();
    session.event_task.abort();
    session.latency_task.abort();
    for task in session.remote_tasks.lock().drain().map(|(_, task)| task) {
        task.abort();
    }
    session.audio_thread.shutdown();
    let _ = session.room.close().await;
}

/// 向前端发送当前房间快照
fn emit_snapshot(
    app: &AppHandle,
    room: &Room,
    room_name: &str,
    backend: InferenceBackend,
    latency: Option<u32>,
) {
    let snapshot = audio_engine::room_snapshot(room, room_name, backend, latency);
    let _ = app.emit("voice://room-state", snapshot);
}

/// 从 LiveKit WebRTC 统计信息中读取当前候选链路往返延迟
async fn read_room_latency(room: &Room) -> Option<u32> {
    use livekit::webrtc::stats::RtcStats;
    let stats = room.get_stats().await.ok()?;
    stats
        .publisher_stats
        .into_iter()
        .chain(stats.subscriber_stats)
        .find_map(|stat| {
            let RtcStats::CandidatePair(pair) = stat else {
                return None;
            };
            let seconds = pair.candidate_pair.current_round_trip_time;
            (seconds > 0.0).then_some((seconds * 1000.0).round() as u32)
        })
}

/// 定时采样 WebRTC 往返延迟并发送房间快照
fn spawn_latency_task(
    app: AppHandle,
    room: Arc<Room>,
    room_name: String,
    backend: InferenceBackend,
    latency: Arc<AtomicU32>,
) -> JoinHandle<()> {
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(2));
        loop {
            interval.tick().await;
            if let Some(value) = read_room_latency(&room).await {
                latency.store(value.max(1), Ordering::Relaxed);
                emit_snapshot(&app, &room, &room_name, backend, Some(value));
            }
        }
    })
}

/// 启动房间事件转发和远端音频播放任务
fn spawn_room_event_task(
    app: AppHandle,
    room: Arc<Room>,
    room_name: String,
    mixer: AudioMixer,
    remote_tasks: Arc<Mutex<HashMap<String, JoinHandle<()>>>>,
    backend: InferenceBackend,
    output_sample_rate: u32,
    latency: Arc<AtomicU32>,
    mut events: mpsc::UnboundedReceiver<RoomEvent>,
) -> JoinHandle<()> {
    tokio::spawn(async move {
        while let Some(event) = events.recv().await {
            match event {
                RoomEvent::TrackSubscribed {
                    track: RemoteTrack::Audio(track),
                    participant,
                    ..
                } => {
                    let identity = participant.identity().to_string();
                    let task = audio_engine::spawn_remote_audio_task(
                        identity.clone(),
                        track,
                        output_sample_rate,
                        mixer.clone(),
                    );
                    remote_tasks.lock().insert(identity, task);
                }
                RoomEvent::TrackUnsubscribed { participant, .. } => {
                    remote_tasks
                        .lock()
                        .remove(&participant.identity().to_string());
                    audio_engine::remove_participant(&mixer, &participant.identity().to_string());
                }
                RoomEvent::ParticipantDisconnected(participant) => {
                    let identity = participant.identity().to_string();
                    if let Some(task) = remote_tasks.lock().remove(&identity) {
                        task.abort();
                    }
                    audio_engine::remove_participant(&mixer, &identity);
                    let _ = app.emit("voice://room-sound", "leave");
                }
                RoomEvent::ParticipantConnected(_) => {
                    let _ = app.emit("voice://room-sound", "join");
                }
                RoomEvent::Disconnected { .. } => {
                    let _ = app.emit(
                        "voice://room-state",
                        serde_json::json!({ "connectionState": "Disconnected" }),
                    );
                    break;
                }
                _ => {}
            }
            let latency = match latency.load(Ordering::Relaxed) {
                0 => None,
                value => Some(value),
            };
            emit_snapshot(&app, &room, &room_name, backend, latency);
        }
    })
}

/// 连接 LiveKit、创建原生音频链路并发布麦克风
#[tauri::command]
pub async fn native_join_room(
    app: AppHandle,
    state: State<'_, NativeAppState>,
    request: JoinRoomRequest,
) -> Result<(), String> {
    let mut current = state.session.lock().await;
    if let Some(session) = current.take() {
        close_session(session).await;
    }
    let token = fetch_token(&request).await?;
    let room_url = token.url.as_deref().unwrap_or(LIVEKIT_URL);
    let preferences = request.preferences.clone();
    let mixer = audio_engine::create_mixer(preferences.output_volume);
    let (input_sender, input_receiver) = mpsc::channel(32);
    let (audio_thread, input_sample_rate, output_sample_rate) = audio_engine::start_audio_thread(
        preferences.input_device_id.clone(),
        preferences.output_device_id.clone(),
        input_sender,
        mixer.clone(),
        app.clone(),
    )?;
    if input_sample_rate != 48000 {
        audio_thread.shutdown();
        return Err(format!(
            "当前麦克风采样率为 {input_sample_rate} Hz，原生降噪链路要求 48000 Hz"
        ));
    }
    let source_options = AudioSourceOptions {
        echo_cancellation: preferences.echo_cancellation,
        noise_suppression: false,
        auto_gain_control: false,
        ..Default::default()
    };
    let microphone_source = NativeAudioSource::new(source_options, 48000, 1, 100);
    let microphone_track = audio_engine::create_local_track(microphone_source.clone());
    let mut room_options = livekit::prelude::RoomOptions::default();
    room_options.adaptive_stream = true;
    room_options.dynacast = true;
    let (room, events) = match Room::connect(room_url, &token.token, room_options).await {
        Ok(result) => result,
        Err(error) => {
            audio_thread.shutdown();
            return Err(format!("连接 LiveKit 失败: {error}"));
        }
    };
    let room = Arc::new(room);
    if let Err(error) = room
        .local_participant()
        .set_name(request.display_name.clone())
        .await
    {
        audio_thread.shutdown();
        let _ = room.close().await;
        return Err(format!("同步昵称失败: {error}"));
    }
    if let Err(error) = room
        .local_participant()
        .publish_track(
            LocalTrack::Audio(microphone_track.clone()),
            audio_engine::microphone_publish_options(),
        )
        .await
    {
        audio_thread.shutdown();
        let _ = room.close().await;
        return Err(format!("发布麦克风失败: {error}"));
    }
    if let Err(error) = room
        .local_participant()
        .set_attributes(HashMap::from([(
            String::from("voice.outputMuted"),
            String::from("false"),
        )]))
        .await
    {
        audio_thread.shutdown();
        let _ = room.close().await;
        return Err(format!("同步输出状态失败: {error}"));
    }
    let backend = current_backend();
    let audio_settings = Arc::new(Mutex::new(AudioRuntimeSettings {
        input_gain: f32::from(preferences.input_volume.min(300)) / 100.0,
        noise_suppression: preferences.noise_suppression,
        noise_reduction_level: preferences.noise_reduction_level,
        echo_cancellation: preferences.echo_cancellation,
    }));
    let input_task = match audio_engine::spawn_capture_task(
        input_receiver,
        microphone_source.clone(),
        audio_settings.clone(),
        &preferences,
        app.clone(),
    ) {
        Ok(task) => task,
        Err(error) => {
            audio_thread.shutdown();
            let _ = room.close().await;
            return Err(error);
        }
    };
    let remote_tasks = Arc::new(Mutex::new(HashMap::new()));
    let latency = Arc::new(AtomicU32::new(0));
    let event_task = spawn_room_event_task(
        app.clone(),
        room.clone(),
        request.room_name.clone(),
        mixer.clone(),
        remote_tasks.clone(),
        backend,
        output_sample_rate,
        latency.clone(),
        events,
    );
    let latency_task = spawn_latency_task(
        app.clone(),
        room.clone(),
        request.room_name.clone(),
        backend,
        latency,
    );
    audio_engine::add_system_tone(&mixer, output_sample_rate, true);
    emit_snapshot(&app, &room, &request.room_name, backend, None);
    *current = Some(NativeRoomSession {
        room,
        microphone_track,
        mixer,
        audio_thread,
        audio_settings,
        input_device_id: preferences.input_device_id,
        output_device_id: preferences.output_device_id,
        input_task,
        event_task,
        latency_task,
        remote_tasks,
        inference_backend: backend,
        room_name: request.room_name,
        output_sample_rate,
    });
    Ok(())
}

/// 离开当前房间并释放全部原生音频资源
#[tauri::command]
pub async fn native_leave_room(
    app: AppHandle,
    state: State<'_, NativeAppState>,
) -> Result<(), String> {
    if let Some(session) = state.session.lock().await.take() {
        audio_engine::add_system_tone(&session.mixer, session.output_sample_rate, false);
        close_session(session).await;
    }
    let _ = app.emit(
        "voice://room-state",
        serde_json::json!({ "connectionState": "Disconnected", "participants": [] }),
    );
    Ok(())
}

/// 切换当前用户的麦克风发布状态
#[tauri::command]
pub async fn native_set_microphone_muted(
    app: AppHandle,
    state: State<'_, NativeAppState>,
    muted: bool,
) -> Result<(), String> {
    let current = state.session.lock().await;
    let session = current
        .as_ref()
        .ok_or_else(|| "当前未加入房间".to_string())?;
    if muted {
        session.microphone_track.mute();
    } else {
        session.microphone_track.unmute();
    }
    emit_snapshot(
        &app,
        &session.room,
        &session.room_name,
        session.inference_backend,
        None,
    );
    Ok(())
}

/// 切换当前用户的远端声音输出状态
#[tauri::command]
pub async fn native_set_output_muted(
    app: AppHandle,
    state: State<'_, NativeAppState>,
    muted: bool,
) -> Result<(), String> {
    let current = state.session.lock().await;
    let session = current
        .as_ref()
        .ok_or_else(|| "当前未加入房间".to_string())?;
    audio_engine::update_output(&session.mixer, Some(muted), None);
    session
        .room
        .local_participant()
        .set_attributes(HashMap::from([(
            String::from("voice.outputMuted"),
            muted.to_string(),
        )]))
        .await
        .map_err(|error| format!("同步输出状态失败: {error}"))?;
    emit_snapshot(
        &app,
        &session.room,
        &session.room_name,
        session.inference_backend,
        None,
    );
    Ok(())
}

/// 修改全局输入输出音量或处理开关
#[tauri::command]
pub async fn native_update_audio_preferences(
    state: State<'_, NativeAppState>,
    preferences: NativeAudioPreferences,
) -> Result<(), String> {
    let mut current = state.session.lock().await;
    let session = current
        .as_mut()
        .ok_or_else(|| "当前未加入房间".to_string())?;
    if session.input_device_id != preferences.input_device_id
        || session.output_device_id != preferences.output_device_id
    {
        session.audio_thread.update_devices(
            preferences.input_device_id.clone(),
            preferences.output_device_id.clone(),
        )?;
        session.input_device_id = preferences.input_device_id.clone();
        session.output_device_id = preferences.output_device_id.clone();
    }
    audio_engine::update_output(&session.mixer, None, Some(preferences.output_volume));
    let mut settings = session.audio_settings.lock();
    settings.input_gain = f32::from(preferences.input_volume.min(300)) / 100.0;
    settings.noise_suppression = preferences.noise_suppression;
    settings.noise_reduction_level = preferences.noise_reduction_level;
    settings.echo_cancellation = preferences.echo_cancellation;
    Ok(())
}

/// 修改当前客户端听到的某位成员音量
#[tauri::command]
pub async fn native_set_participant_volume(
    state: State<'_, NativeAppState>,
    identity: String,
    volume: u16,
) -> Result<(), String> {
    let current = state.session.lock().await;
    let session = current
        .as_ref()
        .ok_or_else(|| "当前未加入房间".to_string())?;
    audio_engine::update_participant_volume(&session.mixer, &identity, volume.min(300));
    Ok(())
}

/// 修改当前用户昵称并立即同步到 LiveKit 房间
#[tauri::command]
pub async fn native_set_display_name(
    app: AppHandle,
    state: State<'_, NativeAppState>,
    display_name: String,
) -> Result<(), String> {
    let display_name = display_name.trim();
    if display_name.is_empty() {
        return Err("昵称不能为空".to_string());
    }
    let current = state.session.lock().await;
    let session = current
        .as_ref()
        .ok_or_else(|| "当前未加入房间".to_string())?;
    session
        .room
        .local_participant()
        .set_name(display_name.to_string())
        .await
        .map_err(|error| format!("同步昵称失败: {error}"))?;
    emit_snapshot(
        &app,
        &session.room,
        &session.room_name,
        session.inference_backend,
        None,
    );
    Ok(())
}
