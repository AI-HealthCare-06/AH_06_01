package com.rexrun.demo;

import android.content.ComponentName;
import android.content.pm.PackageManager;
import android.os.Build;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.ArrayList;
import java.util.List;

@CapacitorPlugin(name = "DinosaurAppIcon")
public class DinosaurAppIconPlugin extends Plugin {
    private static final String[] ALIASES = {
        "Tyranno", "Tricera", "Raptor", "Stego", "Ptera", "Brachio"
    };

    @PluginMethod
    public void setDinosaur(PluginCall call) {
        Integer dinosaur = call.getInt("dinosaur");
        if (dinosaur == null || dinosaur < 0 || dinosaur >= ALIASES.length) {
            call.reject("Unknown dinosaur");
            return;
        }
        getActivity().runOnUiThread(() -> {
            try {
                PackageManager manager = getContext().getPackageManager();
                String packageName = getContext().getPackageName();
                List<PackageManager.ComponentEnabledSetting> changes = new ArrayList<>();
                // Enable the replacement first on older Android; never leave zero launchers.
                ComponentName selected = new ComponentName(packageName, packageName + ".icon." + ALIASES[dinosaur]);
                if (Build.VERSION.SDK_INT < 33) {
                    manager.setComponentEnabledSetting(selected, PackageManager.COMPONENT_ENABLED_STATE_ENABLED,
                        PackageManager.DONT_KILL_APP);
                }
                for (int i = 0; i < ALIASES.length; i++) {
                    ComponentName component = new ComponentName(packageName, packageName + ".icon." + ALIASES[i]);
                    int desired = i == dinosaur ? PackageManager.COMPONENT_ENABLED_STATE_ENABLED
                        : PackageManager.COMPONENT_ENABLED_STATE_DISABLED;
                    int current = manager.getComponentEnabledSetting(component);
                    boolean enabled = current == PackageManager.COMPONENT_ENABLED_STATE_ENABLED
                        || (current == PackageManager.COMPONENT_ENABLED_STATE_DEFAULT && i == 0);
                    if (enabled == (i == dinosaur)) continue;
                    if (Build.VERSION.SDK_INT >= 33) {
                        changes.add(new PackageManager.ComponentEnabledSetting(component, desired, PackageManager.DONT_KILL_APP));
                    } else {
                        manager.setComponentEnabledSetting(component, desired, PackageManager.DONT_KILL_APP);
                    }
                }
                if (Build.VERSION.SDK_INT >= 33 && !changes.isEmpty()) manager.setComponentEnabledSettings(changes);
                JSObject result = new JSObject();
                result.put("dinosaur", dinosaur);
                call.resolve(result);
            } catch (Exception error) {
                call.reject("Could not update launcher icon", error);
            }
        });
    }
}
