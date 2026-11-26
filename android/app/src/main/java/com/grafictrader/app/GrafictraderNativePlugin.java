package com.grafictrader.app;

import android.Manifest;
import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.media.projection.MediaProjectionConfig;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.speech.tts.TextToSpeech;
import android.media.projection.MediaProjectionManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
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
import java.util.ArrayList;
import java.util.Locale;

/** Bridge between the web app and the native broker watcher. */
@CapacitorPlugin(name = "GrafictraderNative", permissions = {@Permission(alias = "microphone", strings = {Manifest.permission.RECORD_AUDIO})})
public class GrafictraderNativePlugin extends Plugin {

    private static final String DEFAULT_SERVER = "https://grafictrader.vercel.app";
    private SpeechRecognizer liveRecognizer;
    private TextToSpeech liveTts;

    @Override
    public void load() {
        liveTts = new TextToSpeech(getContext(), status -> { if (status == TextToSpeech.SUCCESS && liveTts != null) liveTts.setLanguage(new Locale("pt", "PT")); });
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
        if (liveRecognizer != null) { liveRecognizer.destroy(); liveRecognizer = null; }
        if (liveTts != null) { liveTts.stop(); liveTts.shutdown(); liveTts = null; }
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
    public void consumeLaunchMode(PluginCall call) {
        android.content.SharedPreferences prefs = getContext().getSharedPreferences("grafictrader_launch", Context.MODE_PRIVATE);
        String mode = prefs.getString("mode", "");
        prefs.edit().remove("mode").apply();
        JSObject result = new JSObject();
        result.put("mode", mode);
        call.resolve(result);
    }


    @PluginMethod
    public void startVoiceRecognition(PluginCall call) {
        if (!hasPermission("microphone")) {
            requestPermissionForAlias("microphone", call, "microphonePermissionCallback");
            return;
        }
        beginVoiceRecognition(call);
    }

    @PermissionCallback
    private void microphonePermissionCallback(PluginCall call) {
        if (call == null) return;
        if (hasPermission("microphone")) beginVoiceRecognition(call);
        else call.reject("Permite o acesso ao microfone para iniciar o LIVE.", "MICROPHONE_PERMISSION");
    }

    private void beginVoiceRecognition(PluginCall call) {
        if (!SpeechRecognizer.isRecognitionAvailable(getContext())) {
            call.reject("O reconhecimento de voz não está disponível neste telemóvel.", "VOICE_UNAVAILABLE");
            return;
        }
        try {
            if (liveRecognizer != null) liveRecognizer.destroy();
            liveRecognizer = SpeechRecognizer.createSpeechRecognizer(getContext());
            liveRecognizer.setRecognitionListener(new RecognitionListener() {
                @Override public void onReadyForSpeech(Bundle params) { JSObject state = new JSObject(); state.put("status", "listening"); notifyListeners("voiceStatus", state); }
                @Override public void onBeginningOfSpeech() { }
                @Override public void onRmsChanged(float rmsdB) { }
                @Override public void onBufferReceived(byte[] buffer) { }
                @Override public void onEndOfSpeech() { JSObject state = new JSObject(); state.put("status", "processing"); notifyListeners("voiceStatus", state); }
                @Override public void onError(int error) { JSObject data = new JSObject(); data.put("code", error); data.put("message", "Não consegui reconhecer a voz. Tenta novamente."); notifyListeners("voiceError", data); }
                @Override public void onResults(Bundle results) {
                    ArrayList<String> matches = results == null ? null : results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                    if (matches != null && !matches.isEmpty()) { JSObject data = new JSObject(); data.put("text", matches.get(0)); notifyListeners("voiceResult", data); }
                    JSObject state = new JSObject(); state.put("status", "idle"); notifyListeners("voiceStatus", state);
                }
                @Override public void onPartialResults(Bundle partialResults) { }
                @Override public void onEvent(int eventType, Bundle params) { }
            });
            Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, "pt-PT");
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, "pt-PT");
            intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, false);
            liveRecognizer.startListening(intent);
            call.resolve();
        } catch (Exception error) {
            call.reject("Não foi possível iniciar o microfone.", "VOICE_START_FAILED");
        }
    }

    @PluginMethod
    public void stopVoiceRecognition(PluginCall call) {
        if (liveRecognizer != null) { try { liveRecognizer.stopListening(); liveRecognizer.cancel(); } catch (Exception ignored) { } }
        call.resolve();
    }

    @PluginMethod
    public void speakText(PluginCall call) {
        String spoken = call.getString("text", "");
        if (spoken == null || spoken.trim().isEmpty()) { call.reject("Texto vazio."); return; }
        if (liveTts == null) {
            liveTts = new TextToSpeech(getContext(), status -> {
                if (status == TextToSpeech.SUCCESS) { liveTts.setLanguage(new Locale("pt", "PT")); liveTts.speak(spoken, TextToSpeech.QUEUE_FLUSH, null, "grafictrader-live"); }
            });
        } else {
            liveTts.setLanguage(new Locale("pt", "PT"));
            liveTts.speak(spoken, TextToSpeech.QUEUE_FLUSH, null, "grafictrader-live");
        }
        call.resolve();
    }

    @PluginMethod
    public void stopSpeaking(PluginCall call) {
        if (liveTts != null) liveTts.stop();
        call.resolve();
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
        // Whole-screen frames only ever go to the Grafictrader server, whatever the page asks.
        String server = DEFAULT_SERVER;
        Intent intent = new Intent(getContext(), WatchService.class)
                .setAction(WatchService.ACTION_START)
                .putExtra(WatchService.EXTRA_RESULT_CODE, result.getResultCode())
                .putExtra(WatchService.EXTRA_DATA, result.getData())
                .putExtra(WatchService.EXTRA_SERVER, server)
                .putExtra(WatchService.EXTRA_VOICE, Boolean.TRUE.equals(call.getBoolean("voice", false)))
                .putExtra(WatchService.EXTRA_MODE, call.getString("mode", "market"))
                .putExtra(WatchService.EXTRA_EXPIRY_SECONDS, call.getInt("expirySeconds", 60))
                .putExtra(WatchService.EXTRA_PAYOUT_PERCENT, call.getInt("payoutPercent", 80));
        ContextCompat.startForegroundService(getContext(), intent);
        // Leave the broker in front: send this app to the background.
        getActivity().moveTaskToBack(true);
        call.resolve();
    }

    /** Opportunity alerts collected by the app itself (the WebView has no Web Push). */
    @PluginMethod
    public void enableAlerts(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                && ContextCompat.checkSelfPermission(getContext(), Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(getActivity(), new String[] {Manifest.permission.POST_NOTIFICATIONS}, 42);
        }
        // The worker reads the session cookie from storage: write it out now.
        android.webkit.CookieManager.getInstance().flush();
        AlertsWorker.schedule(getContext());
        call.resolve();
    }

    @PluginMethod
    public void disableAlerts(PluginCall call) {
        AlertsWorker.cancel(getContext());
        call.resolve();
    }

    @PluginMethod
    public void alertsStatus(PluginCall call) {
        JSObject result = new JSObject();
        result.put("on", AlertsWorker.isOn(getContext()));
        result.put("notifications", Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU
                || ContextCompat.checkSelfPermission(getContext(), Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED);
        call.resolve(result);
    }

    @PluginMethod
    public void stopWatch(PluginCall call) {
        if (WatchService.isRunning()) {
            getContext().startService(new Intent(getContext(), WatchService.class).setAction(WatchService.ACTION_STOP));
        }
        call.resolve();
    }
}
