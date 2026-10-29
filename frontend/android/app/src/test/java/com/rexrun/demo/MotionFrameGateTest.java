package com.rexrun.demo;

import static org.junit.Assert.*;

import org.junit.Test;

public class MotionFrameGateTest {
    @Test
    public void acceptsNewFramesAndRejectsDuplicateOrBackloggedFrames() {
        MotionFrameGate gate = new MotionFrameGate();
        assertTrue(gate.accept(100));
        assertFalse(gate.accept(100));
        assertFalse(gate.accept(130));
        assertTrue(gate.accept(200));
        assertEquals(2, gate.throttled());
    }

    @Test
    public void slowDeviceReducesCadenceAndReportsMeasuredPercentiles() {
        MotionFrameGate gate = new MotionFrameGate();
        for (int i = 0; i < 5; i++) gate.record(200);
        assertTrue(gate.interval() > 80);
        assertTrue(gate.interval() <= 250);
        assertEquals(200, gate.percentile(.5));
        assertEquals(200, gate.percentile(.95));
        for (int i = 0; i < 140; i++) gate.record(10);
        assertEquals(10, gate.percentile(.95));
        assertEquals(145, gate.frames());
    }
}
