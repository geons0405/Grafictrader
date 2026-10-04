package com.grafictrader.app;

import android.Manifest;
import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.media.projection.MediaProjectionConfig;
import android.media.projection.MediaProjectionManager;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;
import androidx.activity.result.ActivityResult;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import org.json.JSONObject;

/** Bridge between the web app and the native broker watcher. */
@CapacitorPlugin(name = "GrafictraderNative")
public class GrafictraderNativePlugin extends Plugin {

    private static final String DEFAULT_SERVER = "https://grafictrader.vercel.app";

    @Override
    public void load() {
        WatchService.setListener(new WatchService.Listener() {
            @Override
            public void onResult(String json) {
                try {
                    notifyListeners("watchResult", JSObject.fromJSONObject(new JSONObject(json)));
                } catch (Exception ignored) {
                    // malformed response: the bubble already handled it
                }
            }

            @Override
            public void onStopped(String message) {
                JSObject data = new JSObject();
                data.put("message", message);
                notifyListeners("watchStopped", data);
            }
        });
    }

    @Override
    protected void handleOnDestroy() {
        WatchService.setListener(null);
    }

    /**
     * Battery savers close background apps, and the bubble with them. Asks once
     * to run unrestricted; returns true when the system dialog was shown.
     */
    private boolean askBatteryOnce() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return false;
        PowerManager power = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
        if (power == null || power.isIgnoringBatteryOptimizations(getContext().getPackageName())) return false;
        android.content.SharedPreferences prefs = getContext().getSharedPreferences("watch", Context.MODE_PRIVATE);
        if (prefs.getBoolean("askedBattery", false)) return false;
        prefs.edit().putBoolean("askedBattery", true).apply();
        try {
            Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + getContext().getPackageName()));
            getActivity().startActivity(intent);
            return true;
        } catch (Exception error) {
            return false;
        }
    }

    private boolean canDrawOverlays() {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(getContext());
    }

    @PluginMethod
    public void status(PluginCall call) {
        JSObject result = new JSObject();
        result.put("available", true);
        result.put("running", WatchService.isRunning());
        result.put("overlay", canDrawOverlays());
        result.put("lastStop", WatchService.takeLastStop(getContext()));
        call.resolve(result);
    }

    @PluginMethod
    public void startWatch(PluginCall call) {
        if (WatchService.isRunning()) {
            call.resolve();
            return;
        }
        if (!canDrawOverlays()) {
            Intent intent = new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:" + getContext().getPackageName()));
            getActivity().startActivity(intent);
            call.reject("Ativa \"Mostrar por cima de outras apps\" para o Grafictrader e volta a tocar no botão.", "OVERLAY");
            return;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                && ContextCompat.checkSelfPermission(getContext(), Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(getActivity(), new String[] {Manifest.permission.POST_NOTIFICATIONS}, 41);
        }
        if (askBatteryOnce()) {
            call.reject("Permite que o Grafictrader funcione em segundo plano e volta a tocar no botão. Assim o telemóvel não fecha a bolha quando abres a corretora.", "BATTERY");
            return;
        }
        MediaProjectionManager manager = (MediaProjectionManager) getContext().getSystemService(Context.MEDIA_PROJECTION_SERVICE);
        // The bubble reads whatever app is in front, so ask for the whole screen:
        // sharing a single app sends empty frames once the user switches to the broker.
        Intent capture = Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE
                ? manager.createScreenCaptureIntent(MediaProjectionConfig.createConfigForDefaultDisplay())
                : manager.createScreenCaptureIntent();
        startActivityForResult(call, capture, "onProjection");
    }

    @ActivityCallback
    private void onProjection(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) {
            call.reject("A captura do ecrã foi cancelada.", "CANCELLED");
            return;
        }
        String server = call.getString("serverUrl", DEFAULT_SERVER);
        if (server == null || !server.startsWith("https://")) server = DEFAULT_SERVER;
        if (server.endsWith("/")) server = server.substring(0, server.length() - 1);
        Intent intent = new Intent(getContext(), WatchService.class)
                .setAction(WatchService.ACTION_START)
                .putExtra(WatchService.EXTRA_RESULT_CODE, result.getResultCode())
                .putExtra(WatchService.EXTRA_DATA, result.getData())
                .putExtra(WatchService.EXTRA_SERVER, server)
                .putExtra(WatchService.EXTRA_VOICE, Boolean.TRUE.equals(call.getBoolean("voice", false)));
        ContextCompat.startForegroundService(getContext(), intent);
        // Leave the broker in front: send this app to the background.
        getActivity().moveTaskToBack(true);
        call.resolve();
    }

    @PluginMethod
    public void stopWatch(PluginCall call) {
        if (WatchService.isRunning()) {
            getContext().startService(new Intent(getContext(), WatchService.class).setAction(WatchService.ACTION_STOP));
        }
        call.resolve();
    }
}
