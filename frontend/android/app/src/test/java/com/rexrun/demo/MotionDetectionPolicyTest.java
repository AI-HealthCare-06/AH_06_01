package com.rexrun.demo;

import static org.junit.Assert.*;

import org.junit.Test;

public class MotionDetectionPolicyTest {
    @Test
    public void scalesWholeFrameWithoutUpscalingOrChangingAspect() {
        assertArrayEquals(
                new int[] {480, 640}, MotionDetectionPolicy.boundedDimensions(1080, 1440));
        assertArrayEquals(
                new int[] {640, 640}, MotionDetectionPolicy.boundedDimensions(1088, 1088));
        assertArrayEquals(new int[] {320, 240}, MotionDetectionPolicy.boundedDimensions(320, 240));
    }

    @Test
    public void acceptsExportedToolFilenameAndRejectsPaths() {
        assertTrue(MotionDetectionPolicy.toolFilename("tool-abcdef123456.tflite"));
        assertFalse(MotionDetectionPolicy.toolFilename("../tool-model.tflite"));
        assertFalse(MotionDetectionPolicy.toolFilename("tool-model\\.tflite"));
        assertTrue(MotionDetectionPolicy.allowed("cup", false));
        assertFalse(MotionDetectionPolicy.allowed("person", false));
        assertFalse(MotionDetectionPolicy.allowed("cup", true));
    }
}
