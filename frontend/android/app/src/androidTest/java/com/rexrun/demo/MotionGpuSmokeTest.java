package com.rexrun.demo;

import static org.junit.Assert.*;

import android.graphics.Bitmap;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import com.google.mediapipe.framework.image.BitmapImageBuilder;
import com.google.mediapipe.tasks.core.Delegate;
import com.google.mediapipe.tasks.vision.objectdetector.ObjectDetector;

import org.junit.Test;
import org.junit.runner.RunWith;

/** Physical GPU device required: initialization alone misses the first-frame native abort. */
@RunWith(AndroidJUnit4.class)
public class MotionGpuSmokeTest {
    @Test
    public void gpuObjectGraphProcessesFirstFrameAndCloses() {
        ObjectDetector detector =
                ObjectDetector.createFromOptions(
                        InstrumentationRegistry.getInstrumentation().getTargetContext(),
                        MotionDetectionPolicy.options(
                                "public/models/motion-capture/efficientdet_lite0.tflite",
                                Delegate.GPU,
                                .25f));
        try (var image =
                new BitmapImageBuilder(Bitmap.createBitmap(640, 480, Bitmap.Config.ARGB_8888))
                        .build()) {
            assertNotNull(detector.detectForVideo(image, 1));
        } finally {
            detector.close();
        }
    }
}
