package com.rexrun.demo;

import android.Manifest;
import android.content.*;
import android.os.Build;
import com.getcapacitor.*;
import com.getcapacitor.annotation.*;

@CapacitorPlugin(name = "StepSync", permissions = {
    @Permission(alias = "activity", strings = { Manifest.permission.ACTIVITY_RECOGNITION }),
    @Permission(alias = "background", strings = { "android.permission.health.READ_HEALTH_DATA_IN_BACKGROUND" })
})
public class StepSyncPlugin extends Plugin {
    private boolean resumed = true;
    private BroadcastReceiver receiver;

    @Override public void load() {
        if (Build.VERSION.SDK_INT < 34) return;
        // A new WebView must not inherit a former account's background session.
        stopCurrent();
        receiver = new BroadcastReceiver() {
            @Override public void onReceive(Context context, Intent intent) {
                String session = intent.getStringExtra("sessionId");
                if (StepSyncService.ACTION_STOPPED.equals(intent.getAction())) {
                    JSObject value = new JSObject(); value.put("sessionId", session);
                    notifyListeners("stopped", value);
                    return;
                }
                JSObject snapshot = snapshot(session);
                if (snapshot != null) notifyListeners("steps", snapshot);
            }
        };
        IntentFilter filter = new IntentFilter(StepSyncService.ACTION_UPDATED);
        filter.addAction(StepSyncService.ACTION_STOPPED);
        getContext().registerReceiver(receiver, filter, Context.RECEIVER_NOT_EXPORTED);
    }

    @PluginMethod public void authorize(PluginCall call) {
        if (Build.VERSION.SDK_INT < 34) { unavailable(call); return; }
        if (getPermissionState("activity") != PermissionState.GRANTED) {
            requestPermissionForAlias("activity", call, "activityResult");
        } else requestBackground(call);
    }
    @PermissionCallback private void activityResult(PluginCall call) {
        if (getPermissionState("activity") == PermissionState.GRANTED) requestBackground(call);
        else status(call, false, "백그라운드 갱신에는 신체 활동 권한이 필요해요.");
    }
    private void requestBackground(PluginCall call) {
        if (getPermissionState("background") == PermissionState.GRANTED) permissionResult(call);
        else requestPermissionForAlias("background", call, "permissionResult");
    }
    @PermissionCallback private void permissionResult(PluginCall call) {
        boolean allowed = StepSyncService.authorized(getContext());
        status(call, allowed, allowed ? "백그라운드 읽기를 허용했어요." : "Health Connect에서 백그라운드 읽기를 허용해 주세요. 기기에서 지원하지 않을 수도 있어요.");
    }

    @PluginMethod public void start(PluginCall call) {
        if (Build.VERSION.SDK_INT < 34) { unavailable(call); return; }
        String session = call.getString("sessionId");
        if (session == null || session.length() > 100) { call.reject("Invalid session"); return; }
        getActivity().runOnUiThread(() -> {
            if (!resumed || !StepSyncService.authorized(getContext())) {
                status(call, false, "백그라운드 30초 갱신을 사용하려면 추가 읽기 권한을 허용해 주세요.");
                return;
            }
            StepSyncService.STATE.begin(session);
            StepSyncService.STATE.setVisible(true);
            try {
                getContext().startForegroundService(new Intent(getContext(), StepSyncService.class).putExtra("sessionId", session));
                status(call, true, "연결됨 · 앱 사용 중 5초 / 백그라운드 30초 주기로 갱신해요.");
            } catch (RuntimeException error) {
                StepSyncService.STATE.stop(session);
                status(call, false, "백그라운드 갱신을 시작하지 못했어요. 앱에서는 5초마다 확인해요.");
            }
        });
    }
    @PluginMethod public void stop(PluginCall call) {
        if (Build.VERSION.SDK_INT >= 34 && StepSyncService.STATE.matches(call.getString("sessionId"))) stopCurrent();
        call.resolve();
    }
    @PluginMethod public void latest(PluginCall call) {
        JSObject value = Build.VERSION.SDK_INT >= 34 ? snapshot(call.getString("sessionId")) : null;
        call.resolve(value == null ? new JSObject() : value);
    }
    private JSObject snapshot(String owner) {
        if (!StepSyncService.authorized(getContext())) return null;
        StepSyncState.Snapshot sample = StepSyncService.STATE.latest(owner);
        if (sample == null) return null;
        JSObject value = new JSObject();
        value.put("sessionId", owner);
        value.put("date", sample.date);
        value.put("count", sample.count);
        value.put("source", "health-connect");
        value.put("syncedAt", sample.syncedAt);
        return value;
    }
    private void stopCurrent() {
        StepSyncService.STATE.stop(StepSyncService.STATE.session());
        getContext().stopService(new Intent(getContext(), StepSyncService.class));
    }
    private void unavailable(PluginCall call) { status(call, false, "이 기기는 백그라운드 읽기를 지원하지 않아요. 앱에서는 5초마다 확인해요."); }
    private void status(PluginCall call, boolean running, String message) {
        JSObject result = new JSObject(); result.put("running", running); result.put("message", message); call.resolve(result);
    }
    @Override protected void handleOnResume() {
        resumed = true;
        if (Build.VERSION.SDK_INT >= 34) StepSyncService.visible(true);
    }
    @Override protected void handleOnPause() {
        resumed = false;
        if (Build.VERSION.SDK_INT >= 34) StepSyncService.visible(false);
    }
    @Override protected void handleOnDestroy() {
        if (receiver != null) getContext().unregisterReceiver(receiver);
        // The service may outlive an OS-reclaimed activity. Task removal and explicit logout stop it.
    }
}
