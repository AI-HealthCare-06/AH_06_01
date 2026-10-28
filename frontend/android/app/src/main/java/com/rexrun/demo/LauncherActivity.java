package com.rexrun.demo;

import android.app.Activity;
import android.app.ActivityManager;
import android.content.ComponentName;
import android.content.Intent;
import android.os.Bundle;

/** Keep the running task rooted at MainActivity, never at an alias we may disable. */
public class LauncherActivity extends Activity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        ActivityManager manager = (ActivityManager) getSystemService(ACTIVITY_SERVICE);
        for (ActivityManager.AppTask task : manager.getAppTasks()) {
            ActivityManager.RecentTaskInfo info = task.getTaskInfo();
            ComponentName component = info.baseIntent.getComponent();
            if (info.taskId != getTaskId() && component != null
                && component.getClassName().startsWith(getPackageName() + ".icon.")) {
                task.finishAndRemoveTask();
            }
        }
        Intent intent = new Intent(this, MainActivity.class);
        intent.setAction(Intent.ACTION_MAIN);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        startActivity(intent);
        finish();
    }
}
