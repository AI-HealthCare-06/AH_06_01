package com.rexrun.demo;

/** Session fencing keeps a late Health Connect callback out of a replacement account. */
final class StepSyncState {
    private String session;
    private boolean visible = true;
    private Snapshot latest;

    static final class Snapshot {
        final String date;
        final long count;
        final long syncedAt;
        Snapshot(String date, long count, long syncedAt) {
            this.date = date;
            this.count = count;
            this.syncedAt = syncedAt;
        }
    }

    synchronized void begin(String value) {
        if (!value.equals(session)) latest = null;
        session = value;
    }
    synchronized boolean matches(String value) { return value != null && value.equals(session); }
    synchronized String session() { return session; }
    synchronized void stop(String value) {
        if (matches(value)) { session = null; latest = null; }
    }
    synchronized boolean publish(String owner, Snapshot value) {
        if (!matches(owner)) return false;
        if (latest != null && latest.syncedAt > value.syncedAt) return false;
        latest = value;
        return true;
    }
    synchronized Snapshot latest(String owner) { return matches(owner) ? latest : null; }
    synchronized void setVisible(boolean value) { visible = value; }
    synchronized long interval() { return visible ? 5_000L : 30_000L; }
}
