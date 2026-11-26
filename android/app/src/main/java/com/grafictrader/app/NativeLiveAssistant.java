package com.grafictrader.app;

import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.speech.tts.TextToSpeech;
import android.webkit.CookieManager;
import org.json.JSONObject;
import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Turn-based native voice chat hosted inside the existing broker bubble (no Activity/window). */
final class NativeLiveAssistant {
    interface Listener { void onState(String status, String transcript); }
    private final Context context;
    private final String server;
    private final Listener listener;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService network = Executors.newSingleThreadExecutor();
    private final String sessionId = "bubble_" + UUID.randomUUID().toString().replace("-", "");
    private SpeechRecognizer recognizer;
    private TextToSpeech tts;
    private boolean active;
    private boolean speaking;
    private boolean ttsReady;
    private String lastTranscript = "";
    private String symbol = "";

    NativeLiveAssistant(Context context, String server, Listener listener) {
        this.context = context.getApplicationContext();
        this.server = server == null ? "https://grafictrader.vercel.app" : server.replaceAll("/+$", "");
        this.listener = listener;
        tts = new TextToSpeech(this.context, status -> {
            if (status == TextToSpeech.SUCCESS && tts != null) { tts.setLanguage(new Locale("pt", "PT")); ttsReady = true; }
        });
    }

    void setSymbol(String value) { symbol = value == null ? "" : value; }

    boolean isActive() { return active; }
    boolean isSpeaking() { return speaking; }

    void interruptSpeech() {
        main.post(() -> {
            if (tts != null) tts.stop();
            speaking = false;
            emit("LIVE · interrompido", "Podes continuar a falar.");
            if (active) listen();
        });
    }

    void start() {
        main.post(() -> {
            if (active) { stop(); return; }
            if (!SpeechRecognizer.isRecognitionAvailable(context)) {
                emit("Voz indisponível neste telemóvel", "Usa Mensagens para continuar.");
                return;
            }
            active = true;
            if (tts != null) { tts.stop(); speaking = false; }
            if (recognizer != null) recognizer.destroy();
            recognizer = SpeechRecognizer.createSpeechRecognizer(context);
            recognizer.setRecognitionListener(new RecognitionListener() {
                @Override public void onReadyForSpeech(Bundle params) { emit("LIVE · estou a ouvir", lastTranscript); }
                @Override public void onBeginningOfSpeech() { emit("LIVE · a ouvir-te", lastTranscript); }
                @Override public void onRmsChanged(float rmsdB) { }
                @Override public void onBufferReceived(byte[] buffer) { }
                @Override public void onEndOfSpeech() { emit("LIVE · a processar", lastTranscript); }
                @Override public void onError(int error) {
                    if (!active) return;
                    if (error == SpeechRecognizer.ERROR_NO_MATCH || error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT) {
                        main.postDelayed(NativeLiveAssistant.this::listen, 350);
                    } else {
                        emit("LIVE · microfone interrompido", "Toca em Retomar LIVE para voltar a ouvir.");
                        active = false;
                    }
                }
                @Override public void onResults(Bundle results) {
                    if (!active) return;
                    java.util.ArrayList<String> values = results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                    String text = values == null || values.isEmpty() ? "" : values.get(0).trim();
                    if (!text.isEmpty()) ask(text);
                    else main.postDelayed(NativeLiveAssistant.this::listen, 250);
                }
                @Override public void onPartialResults(Bundle partial) {
                    java.util.ArrayList<String> values = partial.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                    if (values != null && !values.isEmpty()) emit("LIVE · a ouvir", values.get(0));
                }
                @Override public void onEvent(int eventType, Bundle params) { }
            });
            listen();
        });
    }

    private void listen() {
        if (!active || recognizer == null || speaking) return;
        try {
            Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, "pt-PT");
            intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
            intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
            recognizer.startListening(intent);
        } catch (Exception error) {
            active = false;
            emit("LIVE · não foi possível ouvir", error.getMessage());
        }
    }

    private void ask(String message) {
        lastTranscript = message;
        emit("LIVE · a pensar", "Tu: " + message);
        network.execute(() -> {
            HttpURLConnection connection = null;
            try {
                URL url = new URL(server + "/api/instructor?chat=1");
                connection = (HttpURLConnection) url.openConnection();
                connection.setRequestMethod("POST");
                connection.setConnectTimeout(12000);
                connection.setReadTimeout(25000);
                connection.setDoOutput(true);
                connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
                String cookie = CookieManager.getInstance().getCookie(server);
                if (cookie != null && !cookie.isEmpty()) connection.setRequestProperty("Cookie", cookie);
                JSONObject body = new JSONObject();
                body.put("sessionId", sessionId);
                body.put("message", message);
                if (!symbol.isEmpty()) { body.put("symbol", symbol); body.put("interval", "5m"); }
                byte[] bytes = body.toString().getBytes(StandardCharsets.UTF_8);
                try (OutputStream out = connection.getOutputStream()) { out.write(bytes); }
                int code = connection.getResponseCode();
                InputStream stream = code >= 200 && code < 300 ? connection.getInputStream() : connection.getErrorStream();
                StringBuilder response = new StringBuilder();
                try (BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8))) {
                    String line; while ((line = reader.readLine()) != null) response.append(line);
                }
                JSONObject json = new JSONObject(response.toString());
                if (code < 200 || code >= 300 || !json.optBoolean("ok")) throw new Exception(json.optString("error", "A IA não conseguiu responder."));
                String answer = json.optString("answer", "").trim();
                if (answer.isEmpty()) throw new Exception("A IA devolveu uma resposta vazia.");
                main.post(() -> speak(answer, message));
            } catch (Exception error) {
                String messageError = error.getMessage() == null ? "Não foi possível obter resposta." : error.getMessage();
                main.post(() -> { emit("LIVE · erro", messageError); if (active) main.postDelayed(this::listen, 700); });
            } finally {
                if (connection != null) connection.disconnect();
            }
        });
    }

    private void speak(String answer, String userMessage) {
        emit("LIVE · a responder", "Tu: " + userMessage + "\nGraficTrader: " + answer);
        if (tts == null || !ttsReady) { if (active) listen(); return; }
        speaking = true;
        tts.setSpeechRate(1.0f);
        tts.speak(answer, TextToSpeech.QUEUE_FLUSH, null, "gt-bubble-live");
        main.postDelayed(() -> {
            speaking = false;
            if (active) listen();
            else emit("LIVE pausado", null);
        }, Math.max(1200, Math.min(18000, answer.length() * 58L)));
    }

    void stop() {
        main.post(() -> {
            active = false;
            speaking = false;
            if (recognizer != null) { try { recognizer.cancel(); recognizer.destroy(); } catch (Exception ignored) { } recognizer = null; }
            if (tts != null) tts.stop();
            emit("LIVE pausado", null);
        });
    }

    private void emit(String status, String transcript) {
        main.post(() -> listener.onState(status, transcript));
    }

    void destroy() {
        stop();
        main.post(() -> { if (tts != null) { tts.shutdown(); tts = null; } });
        network.shutdownNow();
    }
}
