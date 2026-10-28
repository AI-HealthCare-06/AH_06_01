package com.rexrun.demo;
import org.junit.Test;
import static org.junit.Assert.*;
public class StepSyncStateTest {
    @Test public void switchesCadenceAndRejectsFormerSessions() {
        StepSyncState state = new StepSyncState();
        state.begin("first");
        assertEquals(5_000L, state.interval());
        state.setVisible(false);
        assertEquals(30_000L, state.interval());
        assertTrue(state.publish("first", new StepSyncState.Snapshot("2026-10-26", 5000, 100)));
        state.begin("replacement");
        assertNull(state.latest("replacement"));
        assertFalse(state.publish("first", new StepSyncState.Snapshot("2026-10-26", 6000, 200)));
        state.stop("first");
        assertTrue(state.matches("replacement"));
        assertTrue(state.publish("replacement", new StepSyncState.Snapshot("2026-10-26", 4500, 300)));
        state.stop("replacement");
        assertNull(state.latest("replacement"));
        assertFalse(state.publish("replacement", new StepSyncState.Snapshot("2026-10-26", 7000, 400)));
    }
    @Test public void outOfOrderCallbacksCannotReplaceNewerRecords() {
        StepSyncState state = new StepSyncState(); state.begin("owner");
        state.publish("owner", new StepSyncState.Snapshot("2026-10-27", 100, 200));
        assertFalse(state.publish("owner", new StepSyncState.Snapshot("2026-10-26", 9000, 100)));
        assertEquals("2026-10-27", state.latest("owner").date);
    }
}
