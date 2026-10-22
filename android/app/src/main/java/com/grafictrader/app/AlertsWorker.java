package com.grafictrader.app;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;
import android.webkit.CookieManager;
import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;
import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;
import androidx.work.Worker;
import androidx.work.WorkerParameters;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.TimeUnit;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Opportunity alerts inside the Android app. The WebView has no Web Push, so every
 * 15 minutes (the shortest Android allows) this asks the server for the alerts raised
 * since its last look and shows each one as a notification. Uses the account's
 * session cookie from the WebView; nothing else leaves the phone.
 */
public class AlertsWorker extends Worker {

    static final String SERVER = "https://grafictrader.vercel.app";
    private static final String WORK = "opportunity-alerts";
    private static final String PREFS = "alerts";
    private static final String CHANNEL = "alerts";

    public AlertsWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    /** Starts the periodic check (keeps the existing one if already scheduled). */
    static void schedule(Context context) {
        prefs(context).edit().putBoolean("on", true).putLong("since", System.currentTimeMillis()).apply();
        Constraints constraints = new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build();
        PeriodicWorkRequest request = new PeriodicWorkRequest.Builder(AlertsWorker.class, 15, TimeUnit.MINUTES)
                .setConstraints(constraints)
                .build();
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(WORK, ExistingPeriodicWorkPolicy.KEEP, request);
    }

    static void cancel(Context context) {
        prefs(context).edit().putBoolean("on", false).apply();
        WorkManager.getInstance(context).cancelUniqueWork(WORK);
    }

    static boolean isOn(Context context) {
        return prefs(context).getBoolean("on", false);
    }

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    @NonNull
    @Override
    public Result doWork() {
        Context context = getApplicationContext();
        if (!isOn(context)) return Result.success();
        long since = prefs(context).getLong("since", System.currentTimeMillis());
        try {
            HttpURLConnection connection = (HttpURLConnection) new URL(SERVER + "/api/auth?action=alerts-feed&since=" + since).openConnection();
            connection.setConnectTimeout(15000);
            connection.setReadTimeout(20000);
            connection.setRequestProperty("Accept", "application/json");
            String cookies = CookieManager.getInstance().getCookie(SERVER);
            if (cookies != null) connection.setRequestProperty("Cookie", cookies);
            int status = connection.getResponseCode();
            if (status == 401) {
                // Signed out: nothing to show until the person signs in again.
                connection.disconnect();
                return Result.success();
            }
            if (status >= 400) {
                connection.disconnect();
                return Result.retry();
            }
            JSONObject data = new JSONObject(read(connection.getInputStream()));
            connection.disconnect();
            JSONArray alerts = data.optJSONArray("alerts");
            long now = data.optLong("now", System.currentTimeMillis());
            if (alerts != null) {
                // Oldest first, so the newest ends on top.
                for (int i = alerts.length() - 1; i >= 0; i--) show(context, alerts.getJSONObject(i));
            }
            prefs(context).edit().putLong("since", now).apply();
            return Result.success();
        } catch (Exception error) {
            return Result.retry();
        }
    }

    private static void show(Context context, JSONObject alert) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                && ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            return;
        }
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && manager.getNotificationChannel(CHANNEL) == null) {
            NotificationChannel channel = new NotificationChannel(CHANNEL, "Alertas de oportunidade", NotificationManager.IMPORTANCE_HIGH);
            channel.setDescription("Avisa quando a IA vê uma boa oportunidade nos mercados que escolheste.");
            manager.createNotificationChannel(channel);
        }
        int immutable = Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0;
        PendingIntent open = PendingIntent.getActivity(context, 2, new Intent(context, MainActivity.class), immutable);
        String body = alert.optString("body");
        manager.notify(alert.optString("id").hashCode(), new NotificationCompat.Builder(context, CHANNEL)
                .setSmallIcon(R.drawable.ic_stat_watch)
                .setContentTitle(alert.optString("title", "Grafictrader"))
                .setContentText(body)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setAutoCancel(true)
                .setContentIntent(open)
                .build());
    }

    private static String read(InputStream stream) throws java.io.IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] chunk = new byte[8192];
        int n;
        while ((n = stream.read(chunk)) > 0) out.write(chunk, 0, n);
        stream.close();
        return out.toString("UTF-8");
    }
}
