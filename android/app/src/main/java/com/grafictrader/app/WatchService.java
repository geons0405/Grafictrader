package com.grafictrader.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.ComponentCallbacks;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.content.res.Configuration;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Rect;
import android.graphics.PixelFormat;
import android.hardware.display.DisplayManager;
import android.hardware.display.VirtualDisplay;
import android.media.Image;
import android.media.ImageReader;
import android.media.projection.MediaProjection;
import android.media.projection.MediaProjectionManager;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.IBinder;
import android.os.Looper;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.speech.tts.TextToSpeech;
import android.util.Base64;
import android.util.DisplayMetrics;
import android.view.WindowManager;
import android.webkit.CookieManager;
import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONObject;

/**
 * Watches the user's broker app: captures the screen with MediaProjection,
 * sends a frame to /api/watch only when the chart changed, and shows the
 * advice in a floating bubble on top of the broker.
 */
public class WatchService extends Service {

    interface Listener {
        void onResult(String json);

        void onStopped(String message);
    }

    static final String ACTION_START = "com.grafictrader.app.WATCH_START";
    static final String ACTION_STOP = "com.grafictrader.app.WATCH_STOP";
    static final String EXTRA_RESULT_CODE = "resultCode";
    static final String EXTRA_DATA = "data";
    static final String EXTRA_SERVER = "server";
    static final String EXTRA_VOICE = "voice";

    private static final String CHANNEL = "watch";
    private static final int NOTIFICATION_ID = 41;
    private static final int MAX_SIDE = 1600;
    private static final long TICK_MS = 1000;
    private static final long MIN_GAP_MS = 8000;
    private static final long SLOW_GAP_MS = 20000;
    private static final long MAX_GAP_MS = 45000;
    private static final long SESSION_LIMIT_MS = 45 * 60 * 1000;
    private static final double THRESHOLD = 1.5;
    private static final int SIG_W = 96;
    private static final int SIG_H = 54;
    private static final long CLEAN_FRAME_TIMEOUT_MS = 900;

    private static volatile Listener listener;
    private static volatile boolean running;

    static void setListener(Listener value) {
        listener = value;
    }

    static boolean isRunning() {
        return running;
    }

    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService network = Executors.newSingleThreadExecutor();
    private final Stabilizer stabilizer = new Stabilizer();
    private final Map<String, JSONObject> lastByDecision = new HashMap<>();
    private final Object imageLock = new Object();

    private HandlerThread captureThread;
    private Handler capture;
    private MediaProjection projection;
    private VirtualDisplay display;
    private ImageReader reader;
    private Image latest;
    private volatile Bubble bubble;
    private TextToSpeech tts;
    private ComponentCallbacks configCallbacks;

    private String server;
    private boolean voice;
    private volatile boolean inflight;
    private byte[] lastSig;
    private volatile float captureScale = 1f;
    private volatile long frameCount;
    private long lastSentAt;
    private volatile long minGap = MIN_GAP_MS;
    private long startedAt;
    private int analyses;
    private JSONObject current;

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null || ACTION_STOP.equals(intent.getAction())) {
            finish(null);
            return START_NOT_STICKY;
        }
        if (running) return START_NOT_STICKY;

        // Android 14+: the service must be in the foreground before the projection is used.
        ServiceCompat.startForeground(this, NOTIFICATION_ID, notification("A preparar a análise…"),
                Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q ? ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION : 0);

        int resultCode = intent.getIntExtra(EXTRA_RESULT_CODE, 0);
        Intent data = parcelable(intent);
        server = intent.getStringExtra(EXTRA_SERVER);
        voice = intent.getBooleanExtra(EXTRA_VOICE, false);
        MediaProjectionManager manager = (MediaProjectionManager) getSystemService(Context.MEDIA_PROJECTION_SERVICE);
        try {
            projection = manager.getMediaProjection(resultCode, data);
        } catch (Exception error) {
            projection = null;
        }
        if (projection == null || server == null) {
            finish("Não foi possível começar a captura do ecrã.");
            return START_NOT_STICKY;
        }
        running = true;
        startedAt = System.currentTimeMillis();
        projection.registerCallback(new MediaProjection.Callback() {
            @Override
            public void onStop() {
                main.post(() -> finish("A partilha do ecrã terminou."));
            }
        }, main);

        captureThread = new HandlerThread("grafictrader-capture");
        captureThread.start();
        capture = new Handler(captureThread.getLooper());
        createDisplay();
        configCallbacks = new ComponentCallbacks() {
            @Override
            public void onConfigurationChanged(Configuration configuration) {
                capture.post(WatchService.this::resizeDisplay);
            }

            @Override
            public void onLowMemory() {
                // nothing to release
            }
        };
        registerComponentCallbacks(configCallbacks);

        bubble = new Bubble(this, this::openApp, () -> finish(null));
        try {
            bubble.show();
        } catch (Exception error) {
            bubble = null; // overlay permission revoked: keep the notification only
        }
        if (voice) {
            tts = new TextToSpeech(this, status -> {
                if (status == TextToSpeech.SUCCESS && tts != null) tts.setLanguage(new Locale("pt", "PT"));
            });
        }
        capture.postDelayed(this::tick, 1500);
        return START_NOT_STICKY;
    }

    @SuppressWarnings("deprecation")
    private static Intent parcelable(Intent intent) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) return intent.getParcelableExtra(EXTRA_DATA, Intent.class);
        return intent.getParcelableExtra(EXTRA_DATA);
    }

    /* ---------- capture ---------- */

    private int[] captureSize() {
        WindowManager windowManager = (WindowManager) getSystemService(Context.WINDOW_SERVICE);
        DisplayMetrics metrics = new DisplayMetrics();
        windowManager.getDefaultDisplay().getRealMetrics(metrics);
        float scale = Math.min(1f, (float) MAX_SIDE / Math.max(metrics.widthPixels, metrics.heightPixels));
        captureScale = scale;
        int w = Math.max(2, Math.round(metrics.widthPixels * scale) & ~1);
        int h = Math.max(2, Math.round(metrics.heightPixels * scale) & ~1);
        return new int[] {w, h, metrics.densityDpi};
    }

    private ImageReader newReader(int w, int h) {
        ImageReader imageReader = ImageReader.newInstance(w, h, PixelFormat.RGBA_8888, 3);
        imageReader.setOnImageAvailableListener(r -> {
            Image image;
            try {
                image = r.acquireLatestImage();
            } catch (Exception error) {
                return;
            }
            if (image == null) return;
            synchronized (imageLock) {
                if (latest != null) latest.close();
                latest = image;
                frameCount += 1;
            }
        }, capture);
        return imageReader;
    }

    private void createDisplay() {
        int[] size = captureSize();
        reader = newReader(size[0], size[1]);
        display = projection.createVirtualDisplay("grafictrader-watch", size[0], size[1], size[2],
                DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR, reader.getSurface(), null, capture);
    }

    /** The phone was rotated: keep capturing at the new orientation. */
    private void resizeDisplay() {
        if (display == null || !running) return;
        int[] size = captureSize();
        if (reader != null && reader.getWidth() == size[0] && reader.getHeight() == size[1]) return;
        ImageReader old = reader;
        reader = newReader(size[0], size[1]);
        display.resize(size[0], size[1], size[2]);
        display.setSurface(reader.getSurface());
        synchronized (imageLock) {
            if (latest != null) latest.close();
            latest = null;
        }
        lastSig = null;
        if (old != null) old.close();
    }

    private Bitmap latestBitmap() {
        synchronized (imageLock) {
            if (latest == null) return null;
            try {
                Image.Plane plane = latest.getPlanes()[0];
                ByteBuffer buffer = plane.getBuffer();
                int pixelStride = plane.getPixelStride();
                int rowStride = plane.getRowStride();
                int w = latest.getWidth();
                int h = latest.getHeight();
                Bitmap padded = Bitmap.createBitmap(rowStride / pixelStride, h, Bitmap.Config.ARGB_8888);
                buffer.rewind();
                padded.copyPixelsFromBuffer(buffer);
                if (padded.getWidth() == w) return padded;
                Bitmap cropped = Bitmap.createBitmap(padded, 0, 0, w, h);
                padded.recycle();
                return cropped;
            } catch (Exception error) {
                return null;
            }
        }
    }

    /**
     * Tiny grayscale fingerprint of the frame. The bubble's area is blanked out
     * so moving or updating the bubble never counts as a chart change.
     */
    private byte[] signature(Bitmap bitmap) {
        Bubble current = bubble;
        Rect mask = current == null ? null : current.bounds();
        Bitmap source = bitmap;
        if (mask != null) {
            if (!source.isMutable()) source = bitmap.copy(Bitmap.Config.ARGB_8888, true);
            float scale = captureScale;
            int pad = 4;
            Rect scaled = new Rect(
                    Math.round(mask.left * scale) - pad,
                    Math.round(mask.top * scale) - pad,
                    Math.round(mask.right * scale) + pad,
                    Math.round(mask.bottom * scale) + pad);
            new Canvas(source).drawRect(scaled, blackPaint());
        }
        Bitmap small = Bitmap.createScaledBitmap(source, SIG_W, SIG_H, true);
        int[] pixels = new int[SIG_W * SIG_H];
        small.getPixels(pixels, 0, SIG_W, 0, 0, SIG_W, SIG_H);
        if (small != source) small.recycle();
        if (source != bitmap) source.recycle();
        byte[] out = new byte[pixels.length];
        for (int i = 0; i < pixels.length; i++) {
            int p = pixels[i];
            out[i] = (byte) ((((p >> 16) & 0xFF) * 299 + ((p >> 8) & 0xFF) * 587 + (p & 0xFF) * 114) / 1000);
        }
        return out;
    }

    private static android.graphics.Paint blackPaint() {
        android.graphics.Paint paint = new android.graphics.Paint();
        paint.setColor(Color.BLACK);
        return paint;
    }

    private static double diff(byte[] a, byte[] b) {
        if (a == null || b == null || a.length != b.length) return 255;
        long sum = 0;
        for (int i = 0; i < a.length; i++) sum += Math.abs((a[i] & 0xFF) - (b[i] & 0xFF));
        return (double) sum / a.length;
    }

    private void tick() {
        if (!running) return;
        capture.postDelayed(this::tick, TICK_MS);
        if (inflight) return;
        long now = System.currentTimeMillis();
        if (now - startedAt > SESSION_LIMIT_MS) {
            main.post(() -> finish("Sessão terminada ao fim de 45 minutos para poupar análises."));
            return;
        }
        if (lastSentAt != 0 && now - lastSentAt < minGap) return;
        Bitmap bitmap = latestBitmap();
        if (bitmap == null) return;
        byte[] sig = signature(bitmap);
        bitmap.recycle();
        double change = diff(sig, lastSig);
        if (lastSentAt != 0 && change < THRESHOLD && now - lastSentAt < MAX_GAP_MS) return;

        lastSentAt = now;
        inflight = true;
        if (bubble == null) {
            grabAndSend();
            return;
        }
        // Hide the bubble first, then wait for a frame drawn without it, so the
        // AI never sees the bubble covering the chart.
        main.post(() -> {
            if (bubble != null) bubble.setHidden(true);
            long frameAtHide = frameCount;
            long deadline = System.currentTimeMillis() + CLEAN_FRAME_TIMEOUT_MS;
            capture.postDelayed(() -> waitForCleanFrame(frameAtHide, deadline), 120);
        });
    }

    private void waitForCleanFrame(long frameAtHide, long deadline) {
        if (!running) {
            inflight = false;
            return;
        }
        if (frameCount > frameAtHide || System.currentTimeMillis() >= deadline) grabAndSend();
        else capture.postDelayed(() -> waitForCleanFrame(frameAtHide, deadline), 50);
    }

    private void grabAndSend() {
        Bitmap bitmap = latestBitmap();
        main.post(() -> {
            if (bubble != null) bubble.setHidden(false);
        });
        if (bitmap == null || !running) {
            inflight = false;
            // Nothing was sent (e.g. right after a rotation): try again on the next tick.
            lastSentAt = 0;
            return;
        }
        ByteArrayOutputStream jpeg = new ByteArrayOutputStream();
        bitmap.compress(Bitmap.CompressFormat.JPEG, 80, jpeg);
        // Fingerprint of the frame actually sent (bubble-free) for the next change check.
        lastSig = signature(bitmap);
        bitmap.recycle();
        String image = "data:image/jpeg;base64," + Base64.encodeToString(jpeg.toByteArray(), Base64.NO_WRAP);
        network.execute(() -> send(image));
    }

    /* ---------- network ---------- */

    private void send(String image) {
        try {
            JSONObject body = new JSONObject();
            body.put("image", image);
            if (current != null) {
                JSONObject previous = new JSONObject();
                previous.put("decision", stabilizer.shown() != null ? stabilizer.shown() : current.optJSONObject("verdict").optString("decision"));
                JSONObject vision = current.optJSONObject("vision");
                if (vision != null) {
                    previous.put("asset", vision.opt("asset"));
                    previous.put("timeframe", vision.opt("timeframe"));
                }
                body.put("previous", previous);
            }
            HttpURLConnection connection = (HttpURLConnection) new URL(server + "/api/watch").openConnection();
            connection.setRequestMethod("POST");
            connection.setConnectTimeout(15000);
            connection.setReadTimeout(60000);
            connection.setDoOutput(true);
            connection.setRequestProperty("Content-Type", "application/json");
            connection.setRequestProperty("Accept", "application/json");
            String cookies = CookieManager.getInstance().getCookie(server);
            if (cookies != null) connection.setRequestProperty("Cookie", cookies);
            byte[] payload = body.toString().getBytes(StandardCharsets.UTF_8);
            try (OutputStream out = connection.getOutputStream()) {
                out.write(payload);
            }
            int status = connection.getResponseCode();
            InputStream stream = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
            String text = stream == null ? "" : read(stream);
            connection.disconnect();
            main.post(() -> handleResponse(status, text));
        } catch (Exception error) {
            main.post(() -> {
                inflight = false;
                setNotice("Falhou uma análise. A tentar de novo…");
            });
        }
    }

    private static String read(InputStream stream) throws java.io.IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] chunk = new byte[8192];
        int n;
        while ((n = stream.read(chunk)) > 0) out.write(chunk, 0, n);
        stream.close();
        return out.toString("UTF-8");
    }

    private void handleResponse(int status, String text) {
        inflight = false;
        if (!running) return;
        JSONObject data;
        try {
            data = new JSONObject(text);
        } catch (Exception error) {
            data = new JSONObject();
        }
        if (status == 429) {
            minGap = SLOW_GAP_MS;
            setNotice("Muitas análises seguidas: a abrandar.");
            return;
        }
        if (status == 401) {
            finish("Inicia sessão na app Grafictrader para usar a análise ao vivo.");
            return;
        }
        if (status >= 400 || !data.optBoolean("ok")) {
            if (status == 503 || data.optBoolean("setupRequired")) {
                finish(data.optString("error", "A análise por IA não está configurada no servidor."));
            } else {
                setNotice("Falhou uma análise. A tentar de novo…");
            }
            return;
        }
        minGap = MIN_GAP_MS;
        analyses += 1;

        JSONObject verdict = data.optJSONObject("verdict");
        String decision = verdict == null ? "AGUARDAR" : verdict.optString("decision", "AGUARDAR");
        // Only an explicit "true" from the server counts as a chart.
        boolean chartVisible = data.optBoolean("chartVisible", false);
        Stabilizer.Step step = stabilizer.push(decision, chartVisible);
        if (chartVisible) lastByDecision.put(decision, data);
        // No chart now: show this reading, never the last trade.
        JSONObject shown = chartVisible && step.shown != null && lastByDecision.containsKey(step.shown) ? lastByDecision.get(step.shown) : data;
        current = shown;
        render(shown, step, chartVisible);
        if (step.changed) announce(shown, step.shown);

        Listener target = listener;
        if (target != null) target.onResult(text);
    }

    /* ---------- output ---------- */

    private static String label(String decision) {
        if ("COMPRAR".equals(decision)) return "COMPRAR";
        if ("VENDER".equals(decision)) return "VENDER";
        return "NÃO OPERAR";
    }

    private static String side(String decision) {
        if ("COMPRAR".equals(decision)) return "up";
        if ("VENDER".equals(decision)) return "down";
        return "";
    }

    private void render(JSONObject data, Stabilizer.Step step, boolean chartVisible) {
        String decision = chartVisible && step.shown != null ? step.shown : "AGUARDAR";
        JSONObject vision = data.optJSONObject("vision");
        JSONObject verdict = data.optJSONObject("verdict");
        JSONObject guidance = data.optJSONObject("guidance");
        StringBuilder asset = new StringBuilder();
        if (vision != null) {
            if (!vision.isNull("asset")) asset.append(vision.optString("asset")).append(' ');
            if (!vision.isNull("timeframe")) asset.append(vision.optString("timeframe")).append(' ');
        }
        if (verdict != null) asset.append("· ").append(verdict.optInt("confidence")).append('%');

        StringBuilder detail = new StringBuilder();
        if (!chartVisible) detail.append("Não vejo um gráfico. Mostra o gráfico da corretora inteiro.");
        else if (guidance != null) detail.append(guidance.optString("now", ""));
        JSONObject levels = guidance == null ? null : guidance.optJSONObject("levels");
        if (chartVisible && levels != null && !"AGUARDAR".equals(decision)) {
            detail.append("\nEntrada ").append(levels.optString("entry", "—"))
                    .append(" · Stop ").append(levels.optString("stop", "—"))
                    .append(" · Alvo ").append(levels.optString("target", "—"));
        }
        if (chartVisible && step.pending != null) detail.append("\nA confirmar sinal de ").append(label(step.pending)).append("…");

        String title = chartVisible ? label(decision) : "SEM GRÁFICO";
        if (bubble != null) bubble.update(title, side(decision), asset.toString().trim(), detail.toString());
        setNotice(title + " · " + analyses + " análise(s)");
    }

    private void announce(JSONObject data, String decision) {
        Vibrator vibrator = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
        if (vibrator != null && vibrator.hasVibrator()) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) vibrator.vibrate(VibrationEffect.createOneShot(250, VibrationEffect.DEFAULT_AMPLITUDE));
            else vibrator.vibrate(250);
        }
        if (tts != null) {
            JSONObject guidance = data.optJSONObject("guidance");
            String now = guidance == null ? "" : guidance.optString("now", "");
            tts.speak(label(decision) + ". " + now, TextToSpeech.QUEUE_FLUSH, null, "watch");
        }
    }

    private void openApp() {
        Intent intent = new Intent(this, MainActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
        try {
            startActivity(intent);
        } catch (Exception ignored) {
            // background start not allowed on this device: the notification still opens the app
        }
    }

    private Notification notification(String text) {
        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && manager.getNotificationChannel(CHANNEL) == null) {
            NotificationChannel channel = new NotificationChannel(CHANNEL, "Análise ao vivo", NotificationManager.IMPORTANCE_LOW);
            channel.setDescription("Mostra que a IA está a acompanhar a tua corretora.");
            manager.createNotificationChannel(channel);
        }
        int immutable = Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0;
        PendingIntent open = PendingIntent.getActivity(this, 0, new Intent(this, MainActivity.class), immutable);
        PendingIntent stop = PendingIntent.getService(this, 1, new Intent(this, WatchService.class).setAction(ACTION_STOP), immutable);
        return new NotificationCompat.Builder(this, CHANNEL)
                .setSmallIcon(R.drawable.ic_stat_watch)
                .setContentTitle("Grafictrader a analisar a tua corretora")
                .setContentText(text)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setContentIntent(open)
                .addAction(0, "Parar", stop)
                .build();
    }

    private void setNotice(String text) {
        if (!running) return;
        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        manager.notify(NOTIFICATION_ID, notification(text));
    }

    /* ---------- teardown ---------- */

    private void finish(String message) {
        boolean wasRunning = running;
        running = false;
        if (bubble != null) bubble.remove();
        bubble = null;
        if (tts != null) tts.shutdown();
        tts = null;
        if (configCallbacks != null) unregisterComponentCallbacks(configCallbacks);
        configCallbacks = null;
        if (display != null) display.release();
        display = null;
        if (projection != null) projection.stop();
        projection = null;
        synchronized (imageLock) {
            if (latest != null) latest.close();
            latest = null;
        }
        if (reader != null) reader.close();
        reader = null;
        if (captureThread != null) captureThread.quitSafely();
        captureThread = null;
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE);
        stopSelf();
        Listener target = listener;
        if (wasRunning && target != null) target.onStopped(message);
    }

    @Override
    public void onDestroy() {
        if (running) finish(null);
        network.shutdownNow();
        super.onDestroy();
    }
}
