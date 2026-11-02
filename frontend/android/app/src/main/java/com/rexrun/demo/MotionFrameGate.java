package com.rexrun.demo;

import java.util.Arrays;

/** One analyzer, bounded adaptive cadence, and honest processing latency statistics. */
final class MotionFrameGate {
    private long last = -1;
    private long interval = 80;
    private int frames = 0;
    private int throttled = 0;
    private final long[] latencies = new long[120];

    synchronized boolean accept(long timestamp) {
        if (last >= 0 && (timestamp <= last || timestamp - last < interval)) {
            throttled++;
            return false;
        }
        last = timestamp;
        return true;
    }

    synchronized void record(long latency) {
        latencies[frames % latencies.length] = Math.max(0, latency);
        frames++;
        interval =
                Math.max(
                        80,
                        Math.min(
                                250, Math.round(interval * .8 + Math.max(80, latency * 1.2) * .2)));
    }

    synchronized int frames() {
        return frames;
    }

    synchronized int throttled() {
        return throttled;
    }

    synchronized long interval() {
        return interval;
    }

    synchronized long percentile(double p) {
        int n = Math.min(frames, latencies.length);
        if (n == 0) return 0;
        long[] sorted = Arrays.copyOf(latencies, n);
        Arrays.sort(sorted);
        return sorted[Math.max(0, Math.min(n - 1, (int) Math.ceil(n * p) - 1))];
    }
}
