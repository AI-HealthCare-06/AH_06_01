package com.rexrun.demo;

import com.google.mediapipe.tasks.core.BaseOptions;
import com.google.mediapipe.tasks.core.Delegate;
import com.google.mediapipe.tasks.vision.core.RunningMode;
import com.google.mediapipe.tasks.vision.objectdetector.ObjectDetector;

import java.util.Arrays;
import java.util.List;

/** Keep GPU graph configuration separate from application category selection. */
final class MotionDetectionPolicy {
    private static final List<String> OBJECTS = Arrays.asList("cup", "bottle");
    private static final List<String> TOOLS = Arrays.asList("pill", "insulin_pen", "syringe");

    static ObjectDetector.ObjectDetectorOptions options(
            String asset, Delegate delegate, float threshold) {
        // MediaPipe 1.2 GPU aborts for arbitrary class subsets, even after successful
        // initialization.
        // Run all classes, then filter application labels after inference.
        return ObjectDetector.ObjectDetectorOptions.builder()
                .setBaseOptions(
                        BaseOptions.builder()
                                .setModelAssetPath(asset)
                                .setDelegate(delegate)
                                .build())
                .setRunningMode(RunningMode.VIDEO)
                .setScoreThreshold(threshold)
                .setMaxResults(50)
                .build();
    }

    static boolean allowed(String name, boolean medical) {
        return (medical ? TOOLS : OBJECTS).contains(name);
    }

    static boolean toolFilename(String file) {
        return file.matches("tool-[a-zA-Z0-9_.-]+\\.tflite");
    }

    static int[] boundedDimensions(int width, int height) {
        double scale = Math.min(1d, 640d / Math.max(width, height));
        return new int[] {
            Math.max(1, (int) Math.round(width * scale)),
            Math.max(1, (int) Math.round(height * scale))
        };
    }
}
