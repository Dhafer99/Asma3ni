package com.deafapp.mobile;

import android.Manifest;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.Build;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

@CapacitorPlugin(
    name = "NativeAsr",
    permissions = {
        @Permission(alias = "microphone", strings = { Manifest.permission.RECORD_AUDIO }),
        @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS })
    }
)
public class NativeAsrPlugin extends Plugin {
    private static final String EXTRA_VIBRATION_ENABLED = "vibrationEnabled";
    private static final String EXTRA_SENSITIVITY = "sensitivity";
    private static final String EXTRA_LANGUAGE = "language";

    private BroadcastReceiver receiver;

    @Override
    public void load() {
        receiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                JSObject data = new JSObject();
                data.put("type", intent.getStringExtra(NativeAsrService.EXTRA_TYPE));
                data.put("text", intent.getStringExtra(NativeAsrService.EXTRA_TEXT));
                data.put("message", intent.getStringExtra(NativeAsrService.EXTRA_MESSAGE));
                data.put("running", NativeAsrService.isRunning());
                notifyListeners("caption", data, true);
            }
        };

        IntentFilter filter = new IntentFilter(NativeAsrService.ACTION_EVENT);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            getContext().registerReceiver(receiver, filter, Context.RECEIVER_NOT_EXPORTED);
        } else {
            getContext().registerReceiver(receiver, filter);
        }
    }

    @PluginMethod
    public void start(PluginCall call) {
        if (getPermissionState("microphone") != PermissionState.GRANTED) {
            requestPermissionForAliases(new String[] { "microphone", "notifications" }, call, "startAfterPermission");
            return;
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && getPermissionState("notifications") != PermissionState.GRANTED) {
            requestPermissionForAlias("notifications", call, "startAfterPermission");
            return;
        }

        startService();
        call.resolve(statusObject());
    }

    @PluginMethod
    public void stop(PluginCall call) {
        Intent intent = new Intent(getContext(), NativeAsrService.class);
        intent.setAction(NativeAsrService.ACTION_STOP);
        getContext().startService(intent);
        call.resolve(statusObject());
    }

    @PluginMethod
    public void configure(PluginCall call) {
        boolean vibrationEnabled = call.getBoolean(EXTRA_VIBRATION_ENABLED, true);
        int sensitivity = clamp(call.getInt(EXTRA_SENSITIVITY, 70), 0, 100);
        String language = call.getString(EXTRA_LANGUAGE, "fr");

        NativeAsrService.saveSettings(getContext(), vibrationEnabled, sensitivity, language);

        if (NativeAsrService.isRunning()) {
            Intent intent = new Intent(getContext(), NativeAsrService.class);
            intent.setAction(NativeAsrService.ACTION_CONFIGURE);
            intent.putExtra(EXTRA_VIBRATION_ENABLED, vibrationEnabled);
            intent.putExtra(EXTRA_SENSITIVITY, sensitivity);
            intent.putExtra(EXTRA_LANGUAGE, language);
            getContext().startService(intent);
        }

        call.resolve(statusObject());
    }

    @PluginMethod
    public void status(PluginCall call) {
        call.resolve(statusObject());
    }

    @PermissionCallback
    private void startAfterPermission(PluginCall call) {
        if (getPermissionState("microphone") != PermissionState.GRANTED) {
            call.reject("Microphone permission is required for offline captions.");
            return;
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && getPermissionState("notifications") != PermissionState.GRANTED) {
            call.reject("Notification permission is required for notification-bar captions.");
            return;
        }

        startService();
        call.resolve(statusObject());
    }

    @Override
    protected void handleOnDestroy() {
        if (receiver != null) {
            getContext().unregisterReceiver(receiver);
            receiver = null;
        }
    }

    private void startService() {
        Intent intent = new Intent(getContext(), NativeAsrService.class);
        intent.setAction(NativeAsrService.ACTION_START);
        ContextCompat.startForegroundService(getContext(), intent);
    }

    private int clamp(int value, int min, int max) {
        return Math.max(min, Math.min(max, value));
    }

    private JSObject statusObject() {
        JSObject data = new JSObject();
        data.put("running", NativeAsrService.isRunning());
        return data;
    }
}
