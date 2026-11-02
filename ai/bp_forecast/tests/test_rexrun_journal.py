import unittest
from copy import deepcopy
from datetime import datetime

from ai.bp_forecast.history import KST, snapshot, visible_revisions
from ai.bp_forecast.rexrun_journal import from_server_revisions


def revision(number=1):
    return {
        "revision": number,
        "available_at": f"2026-11-02T1{number}:00:00Z",
        "command": {
            "entry_key": "survey:2026-11-02:morning",
            "value": {
                "recorded_on": "2026-11-02",
                "slot": "morning",
                "status": "measured",
                "systolic": 148,
                "diastolic": 94,
                "unit": "mmHg",
                "source": "manual-survey",
                "metadata": {
                    "timePrecision": "minute",
                    "measuredAt": "2026-11-02T08:00:00+09:00",
                    "setting": "home",
                    "method": "upper-arm-cuff",
                    "deviceLabel": "synthetic cuff",
                    "protocolConfirmed": True,
                },
            },
        },
    }


class JournalAdapterTests(unittest.TestCase):
    def test_explicit_measurement_and_server_knowledge_time_are_preserved(self):
        events = from_server_revisions(
            [revision()], subject="synthetic-journal", synthetic=True
        )
        self.assertEqual(events[0].measured_at.hour, 8)
        self.assertEqual(events[0].available_at.hour, 20)
        self.assertEqual(events[0].method, "upper_arm_cuff")
        self.assertNotEqual(events[0].device_id, "synthetic cuff")
        self.assertEqual(
            visible_revisions(
                events, "synthetic-journal", datetime(2026, 11, 2, 19, tzinfo=KST)
            ),
            [],
        )

    def test_legacy_date_only_values_do_not_gain_a_fake_clock_or_device(self):
        row = revision()
        value = row["command"]["value"]
        value["source"] = "legacy-survey"
        value["metadata"] = {
            "timePrecision": "day",
            "measuredAt": None,
            "setting": "unknown",
            "method": "unknown",
            "deviceLabel": None,
            "protocolConfirmed": None,
        }
        events = from_server_revisions(
            [row], subject="synthetic-journal", synthetic=True
        )
        self.assertIsNone(events[0].measured_at)
        self.assertIsNone(events[0].device_id)
        self.assertFalse(
            snapshot(
                events, "synthetic-journal", datetime(2026, 11, 2, 23, tzinfo=KST)
            ).eligible
        )

    def test_local_pending_and_incomplete_latest_head_exports_are_rejected(self):
        for rows in (
            [{**revision(), "revision": None, "available_at": None}],
            [revision(2)],
        ):
            with self.assertRaises(ValueError):
                from_server_revisions(rows, subject="synthetic-journal", synthetic=True)

    def test_later_corrections_and_deletions_keep_the_earlier_value_reconstructable(
        self,
    ):
        first, second, third = revision(1), revision(2), revision(3)
        second["command"]["value"]["systolic"] = 140
        third["command"]["value"].update(
            status="deleted", systolic=None, diastolic=None
        )
        events = from_server_revisions(
            [first, second, third], subject="synthetic-journal", synthetic=True
        )
        before = visible_revisions(
            events, "synthetic-journal", datetime(2026, 11, 2, 20, 30, tzinfo=KST)
        )
        self.assertEqual(before[0].systolic, 148)
        after = visible_revisions(
            events, "synthetic-journal", datetime(2026, 11, 2, 23, tzinfo=KST)
        )
        self.assertEqual(after[0].status, "deleted")

    def test_invented_context_naive_clocks_and_dates_are_rejected(self):
        for patch in (
            {"measuredAt": "2026-11-02T08:00:00"},
            {"measuredAt": "2026-11-01T08:00:00+09:00"},
            {"protocolConfirmed": "yes"},
        ):
            row = deepcopy(revision())
            row["command"]["value"]["metadata"].update(patch)
            with self.assertRaises(ValueError):
                from_server_revisions(
                    [row], subject="synthetic-journal", synthetic=True
                )


if __name__ == "__main__":
    unittest.main()
