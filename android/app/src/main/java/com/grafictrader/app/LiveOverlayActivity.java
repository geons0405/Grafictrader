package com.grafictrader.app;

import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.media.AudioManager;
import android.os.Bundle;
import android.view.Gravity;
import android.view.Window;
import android.view.WindowManager;
import com.getcapacitor.BridgeActivity;

/**
 * Small translucent Capacitor window used only for the full-duplex voice assistant.
 * The broker remains visible behind it; this is not the GraficTrader home screen.
 */
public class LiveOverlayActivity extends BridgeActivity {
    private AudioManager audioManager;
    private int previousAudioMode = AudioManager.MODE_NORMAL;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        getSharedPreferences("grafictrader_launch", MODE_PRIVATE)
                .edit().putString("mode", "live-overlay").apply();
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        getWindow().setBackgroundDrawable(new ColorDrawable(Color.TRANSPARENT));
        getWindow().setDimAmount(0f);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL
                | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN
                | WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE);
        registerPlugin(GrafictraderNativePlugin.class);
        super.onCreate(savedInstanceState);

        getWindow().clearFlags(WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE);
        getWindow().setBackgroundDrawable(new ColorDrawable(Color.TRANSPARENT));
        getWindow().setDimAmount(0f);
        int width = (int) (getResources().getDisplayMetrics().widthPixels * 0.94f);
        int height = (int) (getResources().getDisplayMetrics().heightPixels * 0.68f);
        WindowManager.LayoutParams layout = getWindow().getAttributes();
        layout.width = width;
        layout.height = height;
        layout.gravity = Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL;
        getWindow().setAttributes(layout);
        if (getBridge() != null && getBridge().getWebView() != null) {
            getBridge().getWebView().setBackgroundColor(Color.TRANSPARENT);
        }

        audioManager = (AudioManager) getSystemService(AUDIO_SERVICE);
        if (audioManager != null) {
            previousAudioMode = audioManager.getMode();
            audioManager.setMode(AudioManager.MODE_NORMAL);
            audioManager.setSpeakerphoneOn(true);
        }
    }

    @Override
    protected void onDestroy() {
        if (audioManager != null) {
            audioManager.setSpeakerphoneOn(false);
            audioManager.setMode(previousAudioMode);
        }
        super.onDestroy();
    }

    @Override
    public void onBackPressed() {
        finish();
    }
}
