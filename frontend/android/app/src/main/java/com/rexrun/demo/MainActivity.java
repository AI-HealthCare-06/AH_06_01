package com.rexrun.demo;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;
import android.content.res.Configuration;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(DinosaurAppIconPlugin.class);
        registerPlugin(StepSyncPlugin.class);
        registerPlugin(MotionVisionPlugin.class);
        super.onCreate(savedInstanceState);
        applyDeviceTextSize();
    }
    private void applyDeviceTextSize() {
        if (getBridge() != null && getBridge().getWebView() != null) {
            getBridge().getWebView().getSettings().setTextZoom(Math.round(getResources().getConfiguration().fontScale * 100));
        }
    }
    @Override public void onConfigurationChanged(Configuration config) {
        super.onConfigurationChanged(config);
        applyDeviceTextSize();
    }
}
