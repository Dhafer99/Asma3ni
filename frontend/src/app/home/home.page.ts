import { Component, NgZone, OnDestroy } from '@angular/core';
import { Capacitor, PluginListenerHandle } from '@capacitor/core';
import { NativeAsr, NativeCaptionEvent } from '../native-asr';

const AUDIO_CHUNK_SIZE = 1024;
const TARGET_SAMPLE_RATE = 16000;

type StreamStatus = 'idle' | 'connecting' | 'listening' | 'error';
type AppLanguage = 'fr' | 'ar' | 'en';

const TRANSLATIONS: Record<AppLanguage, Record<string, string>> = {
  fr: {
    appTitle: 'DeafApp',
    eyebrow: 'Sous-titres en arabe tunisien',
    ready: 'Pret',
    connecting: 'Connexion...',
    loadingModel: 'Chargement du modele',
    listening: 'Ecoute en cours',
    idleStatus: 'pret',
    connectingStatus: 'connexion',
    listeningStatus: 'ecoute',
    errorStatus: 'erreur',
    loadingTitle: 'Preparation des sous-titres',
    loadingBody: 'Le modele tunisien se charge sur le telephone. Le premier demarrage peut prendre un moment.',
    quiet: 'Les paroles apparaitront ici des que le modele les entend.',
    start: 'Demarrer l ecoute',
    stop: 'Arreter',
    notifications: 'Notifications',
    vibration: 'Vibration',
    sensitivity: 'Sensibilite du microphone',
    low: 'Faible',
    high: 'Elevee',
    language: 'Langue',
    settings: 'Parametres',
    close: 'Fermer',
    defaultMic: 'Microphone par defaut',
    micInput: 'Entree microphone',
    microphone: 'Microphone',
    asrServer: 'Serveur ASR',
    nativeNote: 'Le mode Android hors ligne utilise le modele tunisien integre et continue via une notification persistante.',
    browserMicNote: 'Si cette page est ouverte depuis un telephone en HTTP sur Wi-Fi, le microphone peut etre bloque. Utilise localhost, HTTPS ou l application Android native.',
    recentSpeech: 'Paroles recentes',
    emptyTranscript: 'Aucun sous-titre confirme pour le moment.',
    clearTranscript: 'Effacer les sous-titres',
    notificationTitle: 'Nouvelle parole detectee',
    unsupported: 'non supporte',
  },
  ar: {
    appTitle: 'DeafApp',
    eyebrow: 'نص مباشر بالدارجة التونسية',
    ready: 'جاهز',
    connecting: 'جاري الاتصال...',
    loadingModel: 'جاري تحميل النموذج',
    listening: 'يستمع الآن',
    idleStatus: 'جاهز',
    connectingStatus: 'اتصال',
    listeningStatus: 'استماع',
    errorStatus: 'خطأ',
    loadingTitle: 'تحضير النص المباشر',
    loadingBody: 'النموذج التونسي يتحمل على الهاتف. أول تشغيل ينجم ياخذ شوية وقت.',
    quiet: 'الكلام يظهر هنا وقت اللي النموذج يسمعو.',
    start: 'ابدأ الاستماع',
    stop: 'إيقاف',
    notifications: 'الإشعارات',
    vibration: 'الاهتزاز',
    sensitivity: 'حساسية الميكروفون',
    low: 'منخفضة',
    high: 'مرتفعة',
    language: 'اللغة',
    settings: 'الإعدادات',
    close: 'إغلاق',
    defaultMic: 'الميكروفون الافتراضي',
    micInput: 'مدخل الميكروفون',
    microphone: 'الميكروفون',
    asrServer: 'خادم التعرف على الكلام',
    nativeNote: 'وضع أندرويد بدون إنترنت يستعمل النموذج التونسي داخل التطبيق ويتواصل عبر إشعار دائم.',
    browserMicNote: 'إذا الصفحة محلولة من الهاتف عبر HTTP في Wi-Fi، الميكروفون ينجم يتمنع. استعمل localhost أو HTTPS أو تطبيق أندرويد.',
    recentSpeech: 'آخر الكلام',
    emptyTranscript: 'ما فما حتى نص مؤكد الآن.',
    clearTranscript: 'مسح النصوص',
    notificationTitle: 'تم اكتشاف كلام جديد',
    unsupported: 'غير مدعوم',
  },
  en: {
    appTitle: 'DeafApp',
    eyebrow: 'Tunisian Arabic live captions',
    ready: 'Ready',
    connecting: 'Connecting...',
    loadingModel: 'Loading model',
    listening: 'Listening now',
    idleStatus: 'ready',
    connectingStatus: 'connecting',
    listeningStatus: 'listening',
    errorStatus: 'error',
    loadingTitle: 'Preparing captions',
    loadingBody: 'The Tunisian model is loading on the phone. First launch can take a moment.',
    quiet: 'Speech will appear here as soon as the model hears it.',
    start: 'Start listening',
    stop: 'Stop',
    notifications: 'Notifications',
    vibration: 'Vibration',
    sensitivity: 'Microphone sensitivity',
    low: 'Low',
    high: 'High',
    language: 'Language',
    settings: 'Settings',
    close: 'Close',
    defaultMic: 'Default microphone',
    micInput: 'Microphone input',
    microphone: 'Microphone',
    asrServer: 'ASR server',
    nativeNote: 'Offline Android mode uses the packaged Tunisian Vosk model and keeps listening through a foreground notification.',
    browserMicNote: 'If this is open from a phone browser over Wi-Fi HTTP, microphone capture may be blocked. Use localhost, HTTPS, or a native Android build.',
    recentSpeech: 'Recent speech',
    emptyTranscript: 'No confirmed captions yet.',
    clearTranscript: 'Clear transcript',
    notificationTitle: 'New speech detected',
    unsupported: 'unsupported',
  },
};

interface CaptionMessage {
  type: 'ready' | 'partial' | 'final' | 'error';
  text?: string;
  message?: string;
}

@Component({
  selector: 'app-home',
  templateUrl: 'home.page.html',
  styleUrls: ['home.page.scss'],
  standalone: false,
})
export class HomePage implements OnDestroy {
  websocketUrl = 'ws://localhost:8000/ws/transcribe';
  isNative = Capacitor.isNativePlatform();
  status: StreamStatus = 'idle';
  modelLoading = false;
  settingsOpen = false;
  language = this.readLanguageSetting();
  notificationPermission = this.getNotificationPermission();
  vibrationEnabled = this.readBooleanSetting('deafapp.vibrationEnabled', true);
  microphoneSensitivity = this.readNumberSetting('deafapp.microphoneSensitivity', 70);
  audioDevices: MediaDeviceInfo[] = [];
  selectedAudioDeviceId = '';
  liveText = '';
  transcript: string[] = [];
  errorMessage = '';
  private socket?: WebSocket;
  private mediaStream?: MediaStream;
  private audioContext?: AudioContext;
  private processor?: ScriptProcessorNode;
  private input?: MediaStreamAudioSourceNode;
  private silentOutput?: GainNode;
  private lastNotificationAt = 0;
  private nativeCaptionListener?: PluginListenerHandle;

  constructor(private readonly zone: NgZone) {}

  ionViewWillEnter(): void {
    void this.loadAudioDevices();
    void this.applyNativeSettings();
  }

  ngOnDestroy(): void {
    this.stopListening();
    void this.nativeCaptionListener?.remove();
    this.nativeCaptionListener = undefined;
  }

  async requestNotifications(): Promise<void> {
    if (!('Notification' in window)) {
      this.notificationPermission = 'unsupported';
      return;
    }

    this.notificationPermission = await Notification.requestPermission();
  }

  async startListening(): Promise<void> {
    if (this.status === 'listening' || this.status === 'connecting') {
      return;
    }

    if (this.isNative) {
      await this.startNativeListening();
      return;
    }

    this.status = 'connecting';
    this.errorMessage = '';
    this.liveText = '';

    try {
      this.ensureMicrophoneApi();
      this.mediaStream = await this.openMicrophone();
      await this.loadAudioDevices();

      this.socket = new WebSocket(this.websocketUrl);
      this.socket.binaryType = 'arraybuffer';

      this.socket.onopen = async () => {
        await this.startAudioPipeline();
        this.zone.run(() => {
          this.status = 'listening';
        });
      };

      this.socket.onmessage = (event) => {
        const message = JSON.parse(event.data) as CaptionMessage;
        this.zone.run(() => this.handleCaptionMessage(message));
      };

      this.socket.onerror = () => {
        this.zone.run(() => this.fail('Could not connect to the ASR server.'));
      };

      this.socket.onclose = () => {
        this.zone.run(() => {
          if (this.status !== 'idle' && this.status !== 'error') {
            this.stopListening();
          }
        });
      };
    } catch (error) {
      this.fail(this.describeMicrophoneError(error));
    }
  }

  stopListening(): void {
    if (this.isNative) {
      void NativeAsr.stop();
      this.status = 'idle';
      this.liveText = '';
      return;
    }

    this.processor?.disconnect();
    this.input?.disconnect();
    this.silentOutput?.disconnect();
    void this.audioContext?.close();
    this.mediaStream?.getTracks().forEach((track) => track.stop());

    if (this.socket && this.socket.readyState <= WebSocket.OPEN) {
      this.socket.close();
    }

    this.processor = undefined;
    this.input = undefined;
    this.silentOutput = undefined;
    this.audioContext = undefined;
    this.mediaStream = undefined;
    this.socket = undefined;
    this.status = 'idle';
    this.liveText = '';
  }

  clearTranscript(): void {
    this.transcript = [];
    this.liveText = '';
  }

  async updateLanguageSetting(language: string | null | undefined): Promise<void> {
    if (language !== 'fr' && language !== 'ar' && language !== 'en') {
      return;
    }

    this.language = language;
    localStorage.setItem('deafapp.language', language);
    await this.applyNativeSettings();
  }

  t(key: string): string {
    return TRANSLATIONS[this.language][key] ?? TRANSLATIONS.fr[key] ?? key;
  }

  statusText(): string {
    if (this.modelLoading) {
      return this.t('loadingModel');
    }

    if (this.status === 'listening') {
      return this.t('listening');
    }

    if (this.status === 'connecting') {
      return this.t('connecting');
    }

    return this.t('ready');
  }

  statusBadgeText(): string {
    if (this.modelLoading) {
      return this.t('loadingModel');
    }

    return this.t(`${this.status}Status`);
  }

  async updateVibrationSetting(enabled: boolean): Promise<void> {
    this.vibrationEnabled = enabled;
    localStorage.setItem('deafapp.vibrationEnabled', String(enabled));
    await this.applyNativeSettings();
  }

  async updateSensitivitySetting(value: number | string | { lower: number; upper: number } | null | undefined): Promise<void> {
    const rawValue = typeof value === 'object' && value !== null ? value.upper : value;
    const sensitivity = Number(rawValue ?? 70);
    if (!Number.isFinite(sensitivity)) {
      return;
    }

    this.microphoneSensitivity = Math.max(0, Math.min(100, sensitivity));
    localStorage.setItem('deafapp.microphoneSensitivity', String(this.microphoneSensitivity));
    await this.applyNativeSettings();
  }

  async loadAudioDevices(): Promise<void> {
    if (!navigator.mediaDevices?.enumerateDevices) {
      this.audioDevices = [];
      return;
    }

    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      this.audioDevices = devices.filter((device) => device.kind === 'audioinput');
    } catch {
      this.audioDevices = [];
    }
  }

  private ensureMicrophoneApi(): void {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error(
        window.isSecureContext
          ? 'This browser does not expose microphone capture.'
          : 'Microphone capture needs HTTPS, localhost, or a native Android build. Open this on localhost or run it through Capacitor on the phone.'
      );
    }
  }

  private async openMicrophone(): Promise<MediaStream> {
    const preferredAudio: MediaTrackConstraints = {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      channelCount: 1,
      ...(this.selectedAudioDeviceId
        ? { deviceId: { exact: this.selectedAudioDeviceId } }
        : {}),
    };

    try {
      return await navigator.mediaDevices.getUserMedia({ audio: preferredAudio });
    } catch (error) {
      if (this.selectedAudioDeviceId) {
        this.selectedAudioDeviceId = '';
      }

      // Some devices reject advanced constraints even though a basic mic stream works.
      return navigator.mediaDevices.getUserMedia({ audio: true });
    }
  }

  private async startAudioPipeline(): Promise<void> {
    if (!this.mediaStream || !this.socket) {
      throw new Error('Audio stream is not ready.');
    }

    this.audioContext = new AudioContext();
    this.input = this.audioContext.createMediaStreamSource(this.mediaStream);
    this.processor = this.audioContext.createScriptProcessor(AUDIO_CHUNK_SIZE, 1, 1);
    this.silentOutput = this.audioContext.createGain();
    this.silentOutput.gain.value = 0;

    this.processor.onaudioprocess = (event) => {
      if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
        return;
      }

      const input = event.inputBuffer.getChannelData(0);
      const pcm = this.to16KhzPcm(input, this.audioContext?.sampleRate ?? 48000);
      this.socket.send(pcm);
    };

    this.input.connect(this.processor);
    this.processor.connect(this.silentOutput);
    this.silentOutput.connect(this.audioContext.destination);
  }

  private async startNativeListening(): Promise<void> {
    this.status = 'connecting';
    this.errorMessage = '';
    this.liveText = '';

    try {
      if (!this.nativeCaptionListener) {
        this.nativeCaptionListener = await NativeAsr.addListener('caption', (event) => {
          this.zone.run(() => this.handleNativeCaption(event));
        });
      }

      await NativeAsr.requestPermissions({ permissions: ['microphone', 'notifications'] });
      await this.applyNativeSettings();
      await NativeAsr.start();
    } catch (error) {
      this.fail(error instanceof Error ? error.message : 'Native caption service failed to start.');
    }
  }

  private handleNativeCaption(event: NativeCaptionEvent): void {
    if (event.type === 'status') {
      if (event.message === 'listening') {
        this.status = 'listening';
        this.modelLoading = false;
      }

      if (event.message === 'loading') {
        this.status = 'connecting';
        this.modelLoading = true;
      }

      if (event.message === 'stopped') {
        this.status = 'idle';
        this.modelLoading = false;
      }

      return;
    }

    if (event.type === 'partial') {
      this.status = 'listening';
      this.modelLoading = false;
      this.liveText = event.text ?? '';
      return;
    }

    if (event.type === 'final' && event.text) {
      this.status = 'listening';
      this.modelLoading = false;
      this.transcript = [event.text, ...this.transcript].slice(0, 20);
      this.liveText = '';
      return;
    }

    if (event.type === 'error') {
      this.fail(event.message ?? 'Native caption service returned an error.');
    }
  }

  private to16KhzPcm(input: Float32Array, sourceRate: number): ArrayBuffer {
    const ratio = sourceRate / TARGET_SAMPLE_RATE;
    const outputLength = Math.floor(input.length / ratio);
    const buffer = new ArrayBuffer(outputLength * 2);
    const view = new DataView(buffer);

    for (let i = 0; i < outputLength; i += 1) {
      const sampleIndex = Math.floor(i * ratio);
      const gain = 0.6 + (this.microphoneSensitivity / 100) * 1.4;
      const sample = Math.max(-1, Math.min(1, input[sampleIndex] * gain));
      view.setInt16(i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    }

    return buffer;
  }

  private handleCaptionMessage(message: CaptionMessage): void {
    if (message.type === 'partial') {
      this.liveText = message.text ?? '';
      return;
    }

    if (message.type === 'final' && message.text) {
      this.transcript = [message.text, ...this.transcript].slice(0, 20);
      this.liveText = '';
      this.notify(message.text);
      return;
    }

    if (message.type === 'error') {
      this.fail(message.message ?? 'The ASR server returned an error.');
    }
  }

  private notify(text: string): void {
    if (!('Notification' in window) || Notification.permission !== 'granted') {
      return;
    }

    const now = Date.now();
    if (now - this.lastNotificationAt < 3500) {
      return;
    }

    this.lastNotificationAt = now;
    new Notification(this.t('notificationTitle'), {
      body: text,
      tag: 'deafapp-caption',
    });
  }

  private fail(message: string): void {
    if (this.isNative) {
      void NativeAsr.stop();
    }

    this.errorMessage = message;
    this.status = 'error';
    this.processor?.disconnect();
    this.input?.disconnect();
    this.silentOutput?.disconnect();
    void this.audioContext?.close();
    this.mediaStream?.getTracks().forEach((track) => track.stop());

    if (this.socket && this.socket.readyState <= WebSocket.OPEN) {
      this.socket.close();
    }
  }

  private getNotificationPermission(): NotificationPermission | 'unsupported' {
    return 'Notification' in window ? Notification.permission : 'unsupported';
  }

  private async applyNativeSettings(): Promise<void> {
    if (!this.isNative) {
      return;
    }

    await NativeAsr.configure({
      vibrationEnabled: this.vibrationEnabled,
      sensitivity: this.microphoneSensitivity,
      language: this.language,
    });
  }

  private readBooleanSetting(key: string, fallback: boolean): boolean {
    const value = localStorage.getItem(key);
    return value === null ? fallback : value === 'true';
  }

  private readNumberSetting(key: string, fallback: number): number {
    const value = Number(localStorage.getItem(key));
    return Number.isFinite(value) ? value : fallback;
  }

  private readLanguageSetting(): AppLanguage {
    const language = localStorage.getItem('deafapp.language');
    return language === 'ar' || language === 'en' || language === 'fr' ? language : 'fr';
  }

  private describeMicrophoneError(error: unknown): string {
    if (!(error instanceof DOMException) && !(error instanceof Error)) {
      return 'Microphone permission failed.';
    }

    const name = 'name' in error ? error.name : '';
    const message = error.message || '';

    if (name === 'NotAllowedError' || name === 'SecurityError') {
      return 'Microphone permission is blocked. Allow microphone access for this site in the browser settings, then try again.';
    }

    if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
      return 'No microphone was found. Connect or enable a microphone, then try again.';
    }

    if (name === 'NotReadableError' || message.toLowerCase().includes('could not start audio source')) {
      return 'The browser could not start the microphone. Close other apps or tabs using the mic, check Windows microphone privacy settings, or choose another input device.';
    }

    if (!window.isSecureContext) {
      return 'Microphone capture needs HTTPS, localhost, or a native Android build. Open this on localhost or run it through Capacitor on the phone.';
    }

    return message || 'Microphone permission failed.';
  }
}
