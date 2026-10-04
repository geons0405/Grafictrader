package com.grafictrader.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Local plugin: screen capture + floating bubble over the broker app.
        registerPlugin(GrafictraderNativePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
