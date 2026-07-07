package com.deafapp.mobile;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.IBinder;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;

import org.json.JSONObject;
import org.json.JSONArray;
import org.vosk.LibVosk;
import org.vosk.LogLevel;
import org.vosk.Model;
import org.vosk.Recognizer;
import org.vosk.android.RecognitionListener;
import org.vosk.android.SpeechService;
import org.vosk.android.StorageService;

import java.io.IOException;

public class NativeAsrService extends Service implements RecognitionListener {
    public static final String ACTION_START = "com.deafapp.mobile.asr.START";
    public static final String ACTION_STOP = "com.deafapp.mobile.asr.STOP";
    public static final String ACTION_CONFIGURE = "com.deafapp.mobile.asr.CONFIGURE";
    public static final String ACTION_EVENT = "com.deafapp.mobile.asr.EVENT";
    public static final String EXTRA_TYPE = "type";
    public static final String EXTRA_TEXT = "text";
    public static final String EXTRA_MESSAGE = "message";

    private static final String CHANNEL_ID = "deafapp_live_captions_v2";
    private static final int NOTIFICATION_ID = 7001;
    private static final float SAMPLE_RATE = 16000.0f;
    private static final String PREFS_NAME = "native_asr_settings";
    private static final String PREF_VIBRATION_ENABLED = "vibrationEnabled";
    private static final String PREF_SENSITIVITY = "sensitivity";
    private static final String PREF_LANGUAGE = "language";
    private static final long VIBRATION_DEBOUNCE_MS = 2500;

    private static volatile boolean running = false;

    private Model model;
    private SpeechService speechService;
    private String lastPartial = "";
    private boolean vibrationEnabled = true;
    private int sensitivity = 70;
    private String language = "fr";
    private long lastVibrationAt = 0;

    public static boolean isRunning() {
        return running;
    }

    public static void saveSettings(Context context, boolean vibrationEnabled, int sensitivity, String language) {
        context
            .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putBoolean(PREF_VIBRATION_ENABLED, vibrationEnabled)
            .putInt(PREF_SENSITIVITY, clamp(sensitivity, 0, 100))
            .putString(PREF_LANGUAGE, normalizeLanguage(language))
            .apply();
    }

    @Override
    public void onCreate() {
        super.onCreate();
        LibVosk.setLogLevel(LogLevel.WARNINGS);
        loadSettings();
        createNotificationChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent == null ? ACTION_START : intent.getAction();
        if (ACTION_STOP.equals(action)) {
            stopSelf();
            return START_NOT_STICKY;
        }

        if (ACTION_CONFIGURE.equals(action)) {
            applySettings(intent);
            return running ? START_STICKY : START_NOT_STICKY;
        }

        applySettings(intent);

        startForeground(NOTIFICATION_ID, buildNotification(label("preparing")));
        startRecognition();
        return START_STICKY;
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onDestroy() {
        stopRecognition();
        running = false;
        broadcast("status", "", "stopped");
        super.onDestroy();
    }

    @Override
    public void onPartialResult(String hypothesis) {
        String text = extractText(hypothesis, "partial");
        if (text.isEmpty() || text.equals(lastPartial) || !passesSensitivityGate(hypothesis, "partial_result", false)) {
            return;
        }

        lastPartial = text;
        broadcast("partial", text, "");
        updateNotification(text);
    }

    @Override
    public void onResult(String hypothesis) {
        String text = extractText(hypothesis, "text");
        if (text.isEmpty() || !passesSensitivityGate(hypothesis, "result", true)) {
            return;
        }

        lastPartial = "";
        broadcast("final", text, "");
        updateNotification(text);
        vibrateForCaption();
    }

    @Override
    public void onFinalResult(String hypothesis) {
        onResult(hypothesis);
    }

    @Override
    public void onError(Exception exception) {
        broadcast("error", "", exception.getMessage());
        updateNotification("Caption service error");
        stopSelf();
    }

    @Override
    public void onTimeout() {
        broadcast("status", "", "timeout");
    }

    private void startRecognition() {
        if (speechService != null) {
            return;
        }

        broadcast("status", "", "loading");
        StorageService.unpack(
            this,
            "model-ar-tn",
            "model-ar-tn",
            unpackedModel -> {
                model = unpackedModel;
                try {
                    Recognizer recognizer = new Recognizer(model, SAMPLE_RATE);
                    recognizer.setWords(true);
                    recognizer.setPartialWords(true);
                    speechService = new SpeechService(recognizer, SAMPLE_RATE);
                    speechService.startListening(this);
                    running = true;
                    broadcast("status", "", "listening");
                    updateNotification(label("listening"));
                } catch (IOException exception) {
                    onError(exception);
                }
            },
            exception -> onError(new RuntimeException("Failed to unpack Vosk model: " + exception.getMessage(), exception))
        );
    }

    private void stopRecognition() {
        if (speechService != null) {
            speechService.stop();
            speechService.shutdown();
            speechService = null;
        }
    }

    private String extractText(String json, String key) {
        try {
            return new JSONObject(json).optString(key, "").trim();
        } catch (Exception ignored) {
            return "";
        }
    }

    private void loadSettings() {
        SharedPreferences preferences = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        vibrationEnabled = preferences.getBoolean(PREF_VIBRATION_ENABLED, true);
        sensitivity = clamp(preferences.getInt(PREF_SENSITIVITY, 70), 0, 100);
        language = normalizeLanguage(preferences.getString(PREF_LANGUAGE, "fr"));
    }

    private void applySettings(Intent intent) {
        if (intent == null) {
            loadSettings();
            return;
        }

        if (intent.hasExtra(PREF_VIBRATION_ENABLED)) {
            vibrationEnabled = intent.getBooleanExtra(PREF_VIBRATION_ENABLED, true);
        }

        if (intent.hasExtra(PREF_SENSITIVITY)) {
            sensitivity = clamp(intent.getIntExtra(PREF_SENSITIVITY, 70), 0, 100);
        }

        if (intent.hasExtra(PREF_LANGUAGE)) {
            language = normalizeLanguage(intent.getStringExtra(PREF_LANGUAGE));
        }

        saveSettings(this, vibrationEnabled, sensitivity, language);
        if (running) {
            updateNotification(label("listening"));
        }
    }

    private boolean passesSensitivityGate(String hypothesis, String resultKey, boolean finalResult) {
        double confidence = averageConfidence(hypothesis, resultKey);
        if (confidence < 0) {
            if (finalResult) {
                return true;
            }

            String text = extractText(hypothesis, "partial");
            int minLength = Math.max(2, 9 - Math.round(sensitivity / 14.0f));
            return text.length() >= minLength;
        }

        double threshold = 0.88 - (sensitivity / 100.0 * 0.58);
        if (finalResult) {
            threshold -= 0.12;
        }

        return confidence >= threshold;
    }

    private double averageConfidence(String json, String resultKey) {
        try {
            JSONArray words = new JSONObject(json).optJSONArray(resultKey);
            if (words == null || words.length() == 0) {
                return -1;
            }

            double total = 0;
            int count = 0;
            for (int i = 0; i < words.length(); i++) {
                JSONObject word = words.optJSONObject(i);
                if (word != null && word.has("conf")) {
                    total += word.optDouble("conf", 0);
                    count += 1;
                }
            }

            return count == 0 ? -1 : total / count;
        } catch (Exception ignored) {
            return -1;
        }
    }

    private void vibrateForCaption() {
        if (!vibrationEnabled) {
            return;
        }

        long now = System.currentTimeMillis();
        if (now - lastVibrationAt < VIBRATION_DEBOUNCE_MS) {
            return;
        }

        lastVibrationAt = now;
        Vibrator vibrator;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            VibratorManager manager = (VibratorManager) getSystemService(Context.VIBRATOR_MANAGER_SERVICE);
            vibrator = manager.getDefaultVibrator();
        } else {
            vibrator = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
        }

        if (vibrator == null || !vibrator.hasVibrator()) {
            return;
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            vibrator.vibrate(VibrationEffect.createOneShot(180, VibrationEffect.DEFAULT_AMPLITUDE));
        } else {
            vibrator.vibrate(180);
        }
    }

    private static int clamp(int value, int min, int max) {
        return Math.max(min, Math.min(max, value));
    }

    private void broadcast(String type, String text, String message) {
        Intent intent = new Intent(ACTION_EVENT);
        intent.setPackage(getPackageName());
        intent.putExtra(EXTRA_TYPE, type);
        intent.putExtra(EXTRA_TEXT, text);
        intent.putExtra(EXTRA_MESSAGE, message);
        sendBroadcast(intent);
    }

    private void updateNotification(String text) {
        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        manager.notify(NOTIFICATION_ID, buildNotification(text));
    }

    private Notification buildNotification(String text) {
        Intent launchIntent = new Intent(this, MainActivity.class);
        launchIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent contentIntent = PendingIntent.getActivity(
            this,
            0,
            launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        Intent stopIntent = new Intent(this, NativeAsrService.class);
        stopIntent.setAction(ACTION_STOP);
        PendingIntent stopPendingIntent = PendingIntent.getService(
            this,
            1,
            stopIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_caption_notification)
            .setContentTitle(label("title"))
            .setContentText(text == null || text.isEmpty() ? label("listening") : text)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(text == null ? "" : text))
            .setContentIntent(contentIntent)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .addAction(R.drawable.ic_caption_notification, label("stop"), stopPendingIntent)
            .build();
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return;
        }

        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            "Live captions",
            NotificationManager.IMPORTANCE_DEFAULT
        );
        channel.setDescription("Persistent notification for Tunisian live captions");
        channel.setShowBadge(false);

        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        manager.createNotificationChannel(channel);
    }

    private static String normalizeLanguage(String value) {
        if ("ar".equals(value) || "en".equals(value) || "fr".equals(value)) {
            return value;
        }

        return "fr";
    }

    private String label(String key) {
        if ("ar".equals(language)) {
            switch (key) {
                case "title":
                    return "DeafApp - النص المباشر";
                case "preparing":
                    return "جاري تحضير النص...";
                case "listening":
                    return "جاري الاستماع";
                case "stop":
                    return "إيقاف";
                default:
                    return "";
            }
        }

        if ("en".equals(language)) {
            switch (key) {
                case "title":
                    return "DeafApp captions";
                case "preparing":
                    return "Preparing captions...";
                case "listening":
                    return "Listening for speech";
                case "stop":
                    return "Stop";
                default:
                    return "";
            }
        }

        switch (key) {
            case "title":
                return "Sous-titres DeafApp";
            case "preparing":
                return "Preparation des sous-titres...";
            case "listening":
                return "Ecoute en cours";
            case "stop":
                return "Arreter";
            default:
                return "";
        }
    }
}
