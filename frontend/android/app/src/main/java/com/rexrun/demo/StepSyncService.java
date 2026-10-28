package com.rexrun.demo;

import android.app.*;
import android.content.*;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.health.connect.*;
import android.health.connect.datatypes.StepsRecord;
import android.os.*;
import androidx.annotation.RequiresApi;
import java.time.*;

/** A single native timer remains alive when the WebView is paused. No network or game writes. */
@RequiresApi(34)
public class StepSyncService extends Service {
    static final String BACKGROUND_PERMISSION = "android.permission.health.READ_HEALTH_DATA_IN_BACKGROUND";
    static final String STEP_PERMISSION = "android.permission.health.READ_STEPS";
    static final String ACTION_UPDATED = "com.rexrun.demo.STEPS_UPDATED";
    static final String ACTION_STOPPED = "com.rexrun.demo.STEPS_STOPPED";
    static final StepSyncState STATE = new StepSyncState();
    private static final String CHANNEL = "rexrun-step-sync";
    private static final int NOTIFICATION_ID = 6105;
    private static StepSyncService instance;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private boolean busy;
    private boolean destroyed;
    private String ownerSession;
    private final Runnable poll = this::read;

    static boolean authorized(Context context) {
        return Build.VERSION.SDK_INT >= 34
            && context.checkSelfPermission(STEP_PERMISSION) == PackageManager.PERMISSION_GRANTED
            && context.checkSelfPermission(BACKGROUND_PERMISSION) == PackageManager.PERMISSION_GRANTED
            && context.checkSelfPermission(android.Manifest.permission.ACTIVITY_RECOGNITION) == PackageManager.PERMISSION_GRANTED;
    }

    static void visible(boolean value) {
        STATE.setVisible(value);
        if (instance != null) instance.handler.post(() -> {
            if (instance == null) return;
            instance.handler.removeCallbacks(instance.poll);
            instance.handler.postDelayed(instance.poll, value ? 0 : STATE.interval());
        });
    }

    @Override public void onCreate() {
        super.onCreate();
        instance = this;
        NotificationManager manager = getSystemService(NotificationManager.class);
        manager.createNotificationChannel(new NotificationChannel(CHANNEL, "걸음 수 갱신", NotificationManager.IMPORTANCE_LOW));
        Intent open = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent action = PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Notification notification = new Notification.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_step_sync)
            .setContentTitle("REXRUN 걸음 수 연결 중")
            .setContentText("앱 사용 중 5초 · 백그라운드 30초 주기로 확인해요")
            .setContentIntent(action).setOngoing(true).setOnlyAlertOnce(true).build();
        try {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_HEALTH);
        } catch (RuntimeException denied) {
            stopSelf();
        }
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null || !authorized(this)) { stopSelf(); return START_NOT_STICKY; }
        String session = intent.getStringExtra("sessionId");
        if (session == null || !STATE.matches(session)) return START_NOT_STICKY;
        ownerSession = session;
        handler.removeCallbacks(poll);
        handler.post(poll);
        return START_NOT_STICKY;
    }

    private void schedule() {
        if (!destroyed && STATE.session() != null) {
            handler.removeCallbacks(poll);
            handler.postDelayed(poll, STATE.interval());
        }
    }

    private void read() {
        if (destroyed) return;
        if (!authorized(this) || STATE.session() == null) { stopSelf(); return; }
        if (busy) { schedule(); return; }
        final String owner = STATE.session();
        final Instant end = Instant.now();
        final ZoneId zone = ZoneId.systemDefault();
        final LocalDate date = end.atZone(zone).toLocalDate();
        Instant start = date.atStartOfDay(zone).toInstant();
        if (!start.isBefore(end)) { schedule(); return; }
        HealthConnectManager manager = getSystemService(HealthConnectManager.class);
        if (manager == null) { stopSelf(); return; }
        AggregateRecordsRequest<Long> request = new AggregateRecordsRequest.Builder<Long>(
            new TimeInstantRangeFilter.Builder().setStartTime(start).setEndTime(end).build())
            .addAggregationType(StepsRecord.STEPS_COUNT_TOTAL).build();
        busy = true;
        try {
            manager.aggregate(request, getMainExecutor(), new OutcomeReceiver<AggregateRecordsResponse<Long>, HealthConnectException>() {
                @Override public void onResult(AggregateRecordsResponse<Long> response) {
                    busy = false;
                    Long count = response.get(StepsRecord.STEPS_COUNT_TOTAL);
                    if (!destroyed && authorized(StepSyncService.this) && count != null && count >= 0
                        && STATE.publish(owner, new StepSyncState.Snapshot(date.toString(), count, end.toEpochMilli()))) {
                        sendBroadcast(new Intent(ACTION_UPDATED).setPackage(getPackageName()).putExtra("sessionId", owner));
                    }
                    schedule();
                }
                @Override public void onError(HealthConnectException error) {
                    busy = false;
                    if (!authorized(StepSyncService.this)) stopSelf(); else schedule();
                }
            });
        } catch (RuntimeException error) {
            busy = false;
            if (!authorized(this)) stopSelf(); else schedule();
        }
    }

    @Override public void onDestroy() {
        destroyed = true;
        handler.removeCallbacksAndMessages(null);
        String stoppedSession = ownerSession != null ? ownerSession : STATE.session();
        STATE.stop(stoppedSession);
        if (stoppedSession != null) sendBroadcast(new Intent(ACTION_STOPPED)
            .setPackage(getPackageName()).putExtra("sessionId", stoppedSession));
        if (instance == this) instance = null;
        stopForeground(STOP_FOREGROUND_REMOVE);
        super.onDestroy();
    }
    @Override public IBinder onBind(Intent intent) { return null; }
}
