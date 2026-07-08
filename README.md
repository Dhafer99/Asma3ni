# DeafApp

Prototype live-caption app for Tunisian Arabic speech.

## What is built

- `frontend/`: Ionic Angular app that captures microphone audio, streams 16 kHz PCM to the backend, shows live captions, and can request browser notification permission.
- `backend/`: FastAPI app with a WebSocket endpoint backed by the LinTO Tunisian Arabic Vosk/Kaldi model.

The ASR model used here is `linagora/linto-asr-ar-tn-0.1`, specifically the lighter `android-model.zip`.

## Run

Backend:

```powershell
cd backend
.\.venv\Scripts\Activate.ps1
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

Frontend:

```powershell
cd frontend
npm start -- --host 0.0.0.0 --port 8100
```

Open `http://localhost:8100`.

On a phone connected to the same Wi-Fi, open `http://<computer-ip>:8100` and set the ASR server field in the app to `ws://<computer-ip>:8000/ws/transcribe`.

## Mobile notes

The Android app now has an offline native path:

- The LinTO/Vosk Tunisian model is packaged into the APK under `frontend/android/app/src/main/assets/model-ar-tn`.
- On first start of the native caption service, Vosk unpacks that asset model into app-private storage because it needs normal filesystem paths.
- The APK is large: the current debug APK is about 207 MB.
- A native Android foreground service keeps the microphone alive and shows a persistent notification with the latest caption and a Stop action.

Build the debug APK:

```powershell
cd frontend
npm run android:sync
$env:JAVA_HOME="C:\Program Files\Android\Android Studio\jbr"
$env:PATH="$env:JAVA_HOME\bin;$env:PATH"
.\android\gradlew.bat -p android assembleDebug
```

APK output:

```text
frontend/android/app/build/outputs/apk/debug/app-debug.apk
```

Install on a USB-connected Android phone:

```powershell
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" install -r .\android\app\build\outputs\apk\debug\app-debug.apk
```

For a release APK, open Android Studio and create a signed build from `frontend/android`. Debug APKs are fine for testing, but Android will show them as developer builds.

Android requirements:

- Use Android Studio's bundled JDK 21 or another Java 21 install. The global Java on this machine is Java 8, which will not build this project.
- The Android project is pinned for this Android Studio version: Android Gradle Plugin `8.7.1`, Gradle `8.9`, `compileSdk 35`, and `targetSdk 35`.
- Grant microphone permission when the app asks.
- On Android 13+, grant notification permission so the foreground caption notification is visible.

The browser/FastAPI path still exists for desktop testing, but the APK uses the packaged native Vosk model instead of the FastAPI server.

## Mobile developer architecture

The mobile app is a Capacitor Android app with an Ionic/Angular UI and a native Android ASR service.

High-level Android flow:

```text
Angular UI
  -> Capacitor NativeAsr plugin
  -> Android foreground service
  -> packaged Vosk model
  -> caption events back to Angular
  -> persistent Android notification
```

Core mobile files:

```text
frontend/src/app/home/home.page.ts
```

Main Angular controller. It decides whether the app is running in browser mode or native Android mode, starts/stops listening, updates settings, stores captions, and applies the lightweight Tunisian correction layer.

Important methods:

- `startListening()`: entry point for the Start button.
- `startNativeListening()`: native Android path.
- `handleNativeCaption()`: receives events from Android.
- `handleCaptionMessage()`: receives WebSocket events from FastAPI in browser mode.
- `correctTunisianText()`: common Tunisian word/phrase correction layer.

```text
frontend/src/app/home/home.page.html
frontend/src/app/home/home.page.scss
```

Ionic UI and styling. The page contains the status band, recent speech area, large live caption area, start/stop controls, settings, microphone sensitivity, vibration toggle, and language selector.

```text
frontend/src/app/native-asr.ts
```

TypeScript interface for the Capacitor plugin. This is what Angular imports as `NativeAsr`.

```text
frontend/android/app/src/main/java/com/deafapp/mobile/MainActivity.java
```

Registers the native plugin with Capacitor:

```java
registerPlugin(NativeAsrPlugin.class);
```

```text
frontend/android/app/src/main/java/com/deafapp/mobile/NativeAsrPlugin.java
```

Bridge between Angular and Android. It exposes `start`, `stop`, `configure`, and permission handling to TypeScript. It also listens for broadcasts from the service and emits `caption` events back to Angular.

```text
frontend/android/app/src/main/java/com/deafapp/mobile/NativeAsrService.java
```

Native Android foreground service. This is the core mobile ASR engine.

Responsibilities:

- starts as a foreground microphone service;
- unpacks the packaged Vosk model from assets on first use;
- creates a Vosk `Recognizer`;
- receives partial and final recognition results;
- applies native-side Tunisian correction;
- sends caption events back to the Capacitor plugin;
- updates the persistent notification with the latest caption;
- optionally vibrates on final captions.

```text
frontend/android/app/src/main/AndroidManifest.xml
```

Declares permissions and the foreground service. Key permissions are `RECORD_AUDIO`, `POST_NOTIFICATIONS`, `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_MICROPHONE`, `WAKE_LOCK`, and `VIBRATE`.

```text
frontend/android/app/src/main/assets/model-ar-tn
```

Packaged Vosk model used by the Android APK. These files are tracked with Git LFS because the model is large.

Common mobile changes:

- Change UI layout/text: edit `home.page.html`, `home.page.scss`, and translations in `home.page.ts`.
- Change correction dictionary: edit `correctTunisianText()` in both `home.page.ts` and `NativeAsrService.java`.
- Change notification behavior: edit `buildNotification()` in `NativeAsrService.java`.
- Change microphone sensitivity behavior: edit the gating logic in `NativeAsrService.java`.
- Change Android permissions/service behavior: edit `AndroidManifest.xml`.
- Replace the offline ASR model: replace `frontend/android/app/src/main/assets/model-ar-tn`, update Git LFS tracking if needed, then rebuild.

## Most important improvement area: correction layer

The fastest and most important way to improve accuracy is the Tunisian correction layer.

The ASR model produces raw text. The correction layer fixes common Tunisian dialect mistakes after recognition, before the text is shown in the UI, saved in recent speech, or displayed in notifications. This lets developers improve practical accuracy without retraining or replacing the ASR model.

There are two correction layers because the app has two runtime paths:

```text
frontend/src/app/home/home.page.ts
```

Browser/web correction layer:

- `TUNISIAN_PHRASE_CORRECTIONS`
- `TUNISIAN_WORD_CORRECTIONS`
- `correctTunisianText()`

This affects browser/FastAPI testing and the Angular UI text handling.

```text
frontend/android/app/src/main/java/com/deafapp/mobile/NativeAsrService.java
```

Native Android correction layer:

- `correctTunisianText()`
- `correctTunisianWord()`

This affects the offline Android APK, including live captions and the foreground notification.

When improving recognition quality, collect real examples in this format:

```text
Raw ASR output: ...
Expected Tunisian text: ...
Context: phone/person/noise level, if useful
```

Then add conservative corrections to both files. Prefer high-confidence common fixes such as repeated wrong words or phrases. Avoid aggressive replacements that could change the meaning of unrelated sentences.

Correction-layer rule of thumb:

- If the ASR hears the right idea but writes it in Modern Standard Arabic, fix it here.
- If the ASR consistently confuses one Tunisian word with another, fix it here.
- If the ASR completely misses the audio, the correction layer will not solve it; that needs model/audio/sensitivity work.

## Repository notes

This repo uses Git LFS for the packaged Android Vosk model under:

```text
frontend/android/app/src/main/assets/model-ar-tn
```

After cloning, install Git LFS and pull the model files:

```powershell
git lfs install
git lfs pull
```

FastAPI is optional for desktop/browser testing. The Android APK does not need the FastAPI server because it runs the packaged Vosk model directly on the phone.

Always-on listening from the notification bar is restricted by Android rules:

- Android requires a foreground service with a persistent notification for continuous microphone access.
- iOS is much more restrictive for continuous background microphone capture.
- If Android kills the app because of battery optimization, disable battery optimization for DeafApp in system settings.

## Microphone troubleshooting

If the app shows `The browser could not start the microphone`:

- Close other apps or browser tabs that may be using the microphone.
- On Windows, check `Settings > Privacy & security > Microphone` and allow microphone access for desktop apps.
- Use the microphone selector in the app and try another input device.
- If you opened the app on a phone with `http://<computer-ip>:8100`, the phone browser may block microphone capture because it is not HTTPS. Use `localhost` on the computer for browser testing, or run a native Android/Capacitor build for phone testing.
