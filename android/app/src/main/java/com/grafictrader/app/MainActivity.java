package com.grafictrader.app;

import android.os.Bundle;
import android.content.Intent;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Local plugin: screen capture + floating bubble over the broker app.
        registerPlugin(GrafictraderNativePlugin.class);
        super.onCreate(savedInstanceState);
        rememberMode(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        rememberMode(intent);
    }

    private void rememberMode(Intent intent) {
        if (intent == null) return;
        String mode = intent.getStringExtra("grafictrader_mode");
        if ("live".equals(mode) || "chat".equals(mode)) {
            getSharedPreferences("grafictrader_launch", MODE_PRIVATE)
                    .edit().putString("mode", mode).apply();
        }
    }
}
