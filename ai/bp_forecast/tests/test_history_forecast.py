import json
import unittest
from dataclasses import replace
from datetime import date, datetime, timedelta
from statistics import mean

from ai.bp_forecast.backtest import (
    backtest,
    outcome,
    purged_training_windows,
    summarize,
)
from ai.bp_forecast.demo import demo_events
from ai.bp_forecast.forecast import METHODS, estimate, forecast
from ai.bp_forecast.history import (
    ContextChange,
    Policy,
    aggregate,
    day_end,
    instant,
    snapshot,
    visible_revisions,
)


class HistoryForecastTests(unittest.TestCase):
    def setUp(self):
        self.events = demo_events()
        self.subject = self.events[0].subject_id
        self.end = self.events[-1].measured_at.date()
        self.as_of = day_end(self.end)

    def test_fixture_provenance_counts_and_eligible_history(self):
        history = snapshot(self.events, self.subject, self.as_of)
        self.assertEqual(len(self.events), 180)
        self.assertEqual(history.provenance, "synthetic")
        self.assertTrue(all(e.synthetic for e in self.events))
        self.assertTrue(history.eligible)
        self.assertEqual(len(history.days), 28)
        self.assertEqual(history.features["reading_count"], 56)
        self.assertEqual(
            (history.days[-1].systolic, history.days[-1].diastolic), (135, 87.5)
        )

    def test_input_rejects_invalid_units_numbers_and_timestamps(self):
        event = self.events[-1]
        for changes in (
            {"unit": "kPa"},
            {"systolic": float("nan")},
            {"diastolic": 200},
            {"systolic": True},
            {"revision": 0},
            {"measured_at": datetime(2026, 11, 2)},  # noqa: DTZ001 -- deliberately invalid input
            {"available_at": event.measured_at - timedelta(seconds=1)},
        ):
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                replace(event, **changes)

    def test_future_events_and_other_people_cannot_change_any_forecast(self):
        baseline = snapshot(self.events, self.subject, self.as_of)
        future = replace(
            self.events[-1],
            event_id="future",
            session_id="future-session",
            measured_at=self.as_of + timedelta(days=1),
            available_at=self.as_of + timedelta(days=1, minutes=1),
            systolic=290,
        )
        other = replace(self.events[-1], subject_id="another-person", systolic=290)
        changed = snapshot(self.events + [future, other], self.subject, self.as_of)
        self.assertEqual(baseline.fingerprint, changed.fingerprint)
        for method in METHODS:
            self.assertEqual(forecast(baseline, method), forecast(changed, method))

    def test_late_correction_is_invisible_until_known(self):
        correction = replace(
            self.events[-1],
            revision=2,
            systolic=190,
            available_at=self.as_of + timedelta(days=1),
        )
        before = snapshot(self.events, self.subject, self.as_of)
        self.assertEqual(
            before.fingerprint,
            snapshot(self.events + [correction], self.subject, self.as_of).fingerprint,
        )
        after = snapshot(
            self.events + [correction], self.subject, self.as_of + timedelta(days=1)
        )
        self.assertNotEqual(before.fingerprint, after.fingerprint)
        self.assertEqual(after.days[-1].systolic, 163)

    def test_late_upload_cannot_be_backfilled_into_historical_features(self):
        late = replace(
            self.events[-1],
            event_id="late",
            session_id="late-session",
            available_at=self.as_of + timedelta(days=2),
        )
        self.assertEqual(
            snapshot(self.events[:-1], self.subject, self.as_of).fingerprint,
            snapshot(self.events[:-1] + [late], self.subject, self.as_of).fingerprint,
        )

    def test_tombstones_apply_only_after_their_availability(self):
        last = self.events[-1]
        tombstone = replace(
            last,
            revision=2,
            status="deleted",
            systolic=None,
            diastolic=None,
            available_at=self.as_of + timedelta(hours=1),
        )
        earlier = visible_revisions(self.events + [tombstone], self.subject, self.as_of)
        later = visible_revisions(
            self.events + [tombstone], self.subject, self.as_of + timedelta(hours=2)
        )
        self.assertEqual(
            next(e for e in earlier if e.event_id == last.event_id).status, "valid"
        )
        self.assertEqual(
            next(e for e in later if e.event_id == last.event_id).status, "deleted"
        )

    def test_retries_are_idempotent_and_conflicting_revisions_fail(self):
        self.assertEqual(
            snapshot(self.events, self.subject, self.as_of).fingerprint,
            snapshot(self.events * 2, self.subject, self.as_of).fingerprint,
        )
        with self.assertRaisesRegex(ValueError, "conflicting payload"):
            snapshot(
                self.events + [replace(self.events[-1], systolic=160)],
                self.subject,
                self.as_of,
            )
        invalid_revision = replace(
            self.events[-1], revision=2, available_at=self.events[-1].measured_at
        )
        with self.assertRaisesRegex(ValueError, "monotonic"):
            snapshot(self.events + [invalid_revision], self.subject, self.as_of)

    def test_sessions_are_balanced_and_source_duplicates_do_not_multiply_weight(self):
        am = replace(self.events[-2], systolic=150, diastolic=90)
        repeat = replace(
            am, event_id="repeat", reading_index=2, systolic=130, diastolic=80
        )
        pm = replace(self.events[-1], systolic=120, diastolic=70)
        rows, _, _ = aggregate(
            [am, repeat, pm], self.subject, self.as_of, self.end, self.end
        )
        # AM=140, PM=120, day=130, not (150+130+120)/3.
        self.assertEqual((rows[0].systolic, rows[0].diastolic), (130, 77.5))
        duplicate = replace(am, event_id="retry-with-another-id")
        again, excluded, _ = aggregate(
            [am, repeat, pm, duplicate], self.subject, self.as_of, self.end, self.end
        )
        self.assertEqual(rows, again)
        self.assertEqual(excluded["duplicate_source_reading"], 1)
        with self.assertRaisesRegex(ValueError, "source reading"):
            aggregate(
                [am, replace(am, event_id="bad-duplicate", systolic=155)],
                self.subject,
                self.as_of,
                self.end,
                self.end,
            )

    def test_unknown_date_context_device_and_clinic_values_do_not_become_home_forecasts(
        self,
    ):
        for changes in (
            {"measured_at": None},
            {"setting": "clinic"},
            {"method": "wrist"},
            {"protocol_confirmed": False},
            {"device_id": None},
        ):
            with self.subTest(changes=changes):
                history = snapshot(
                    [replace(e, **changes) for e in self.events],
                    self.subject,
                    self.as_of,
                )
                self.assertFalse(history.eligible)
                self.assertIsNone(forecast(history)["point"])
        clinic = replace(
            self.events[-1],
            event_id="clinic",
            session_id="clinic-session",
            setting="clinic",
            systolic=190,
        )
        self.assertEqual(
            snapshot(self.events, self.subject, self.as_of).features,
            snapshot(self.events + [clinic], self.subject, self.as_of).features,
        )

    def test_missing_and_stale_histories_abstain_instead_of_becoming_normal(self):
        for events in (
            [],
            self.events[-10:],
            [e for e in self.events if e.slot == "morning"],
            self.events[:-8],
        ):
            with self.subTest(count=len(events)):
                result = forecast(snapshot(events, self.subject, self.as_of))
                self.assertEqual(result["status"], "abstained")
                self.assertIsNone(result["point"])
                self.assertIsNone(result["diagnosis"])

    def test_extreme_reading_is_neither_silently_removed_nor_clipped(self):
        history = snapshot(
            self.events[:-1] + [replace(self.events[-1], systolic=350)],
            self.subject,
            self.as_of,
        )
        self.assertEqual(history.days[-1].systolic, 243)
        self.assertIn("outside_research_support", history.reasons)
        self.assertIsNone(forecast(history)["point"])

    def test_known_changes_suspend_forecasts_without_erasing_raw_history(self):
        changed = [
            replace(e, device_id="other-device")
            if e.measured_at.date() == self.end
            else e
            for e in self.events
        ]
        history = snapshot(changed, self.subject, self.as_of)
        self.assertEqual(len(history.days), 28)
        self.assertIn("device_change_in_lookback", history.reasons)
        context = ContextChange(
            self.subject,
            self.as_of - timedelta(days=1),
            self.as_of - timedelta(hours=1),
        )
        self.assertIn(
            "recent_medication_change",
            snapshot(self.events, self.subject, self.as_of, [context]).reasons,
        )
        self.assertTrue(
            snapshot(
                self.events,
                self.subject,
                self.as_of,
                [replace(context, available_at=self.as_of + timedelta(days=1))],
            ).eligible
        )
        self.assertIn(
            "planned_medication_change",
            snapshot(
                self.events,
                self.subject,
                self.as_of,
                [replace(context, effective_at=self.as_of + timedelta(days=1))],
            ).reasons,
        )

    def test_baselines_use_calendar_time_and_never_borrow_lifestyle_scores(self):
        history = snapshot(self.events, self.subject, self.as_of)
        self.assertAlmostEqual(
            estimate(history, "mean_7d")["systolic"],
            sum(d.systolic for d in history.days[-7:]) / 7,
        )
        weights = [2 ** (-(self.end - d.day).days / 7) for d in history.days]
        self.assertAlmostEqual(
            estimate(history, "ewma_7d")["systolic"],
            sum(w * d.systolic for w, d in zip(weights, history.days)) / sum(weights),
        )
        for method in METHODS:
            response = forecast(history, method)
            self.assertFalse(response["production_eligible"])
            self.assertIsNone(response["prediction_interval"])
            self.assertIsNone(response["diagnosis"])
            self.assertNotIn("v9", response["model_version"])
            self.assertNotIn("stage_probs", json.dumps(response))
        with self.assertRaises(ValueError):
            estimate(history, "v9")

    def test_target_dates_follow_local_calendar_and_exclude_input_day(self):
        response = forecast(snapshot(self.events, self.subject, self.as_of))
        self.assertEqual(response["target"]["start"], "2026-11-03")
        self.assertEqual(response["target"]["end"], "2026-11-09")
        self.assertEqual(instant("2026-11-01T15:01:00Z").date(), self.end)

    def test_future_label_requires_maturity_and_adequate_paired_records(self):
        origin = self.end - timedelta(days=7)
        self.assertEqual(
            outcome(self.events, self.subject, origin, self.as_of)[1], "immature_label"
        )
        label, reason = outcome(
            self.events, self.subject, origin, self.as_of + timedelta(days=2)
        )
        expected = [e for e in self.events if e.measured_at.date() > origin]
        self.assertIsNone(reason)
        self.assertAlmostEqual(label["systolic"], mean(e.systolic for e in expected))
        only_am = [e for e in self.events if e.slot == "morning"]
        self.assertEqual(
            outcome(only_am, self.subject, origin, self.as_of + timedelta(days=2))[1],
            "insufficient_future_measurements",
        )

    def test_label_does_not_use_corrections_received_after_freeze(self):
        origin = self.end - timedelta(days=7)
        evaluation = self.as_of + timedelta(days=10)
        late = replace(
            self.events[-1],
            revision=2,
            systolic=290,
            available_at=self.as_of + timedelta(days=5),
        )
        self.assertEqual(
            outcome(self.events, self.subject, origin, evaluation),
            outcome(self.events + [late], self.subject, origin, evaluation),
        )

    def test_unexpected_future_extremes_and_device_changes_remain_in_primary_scoring(
        self,
    ):
        origin = self.end - timedelta(days=7)
        events = self.events[:-1] + [
            replace(self.events[-1], systolic=350, device_id="new-device")
        ]
        label, reason = outcome(
            events, self.subject, origin, self.as_of + timedelta(days=2)
        )
        self.assertIsNone(reason)
        self.assertEqual(
            set(label["quality_flags"]),
            {"future_outside_research_support", "future_mixed_devices"},
        )
        metrics = backtest(
            events, self.subject, [origin], self.as_of + timedelta(days=2)
        )["metrics"]["mean_7d"]
        self.assertEqual(metrics["evaluated_origins"], 1)
        self.assertEqual(
            metrics["observed_label_flags"]["future_outside_research_support"], 1
        )

    def test_abstention_is_separate_and_absent_class_metrics_are_null(self):
        result = backtest(
            self.events,
            self.subject,
            [self.end - timedelta(days=7), self.end],
            self.as_of + timedelta(days=2),
        )
        metric = result["metrics"]["mean_7d"]
        self.assertEqual(
            (
                metric["candidate_origins"],
                metric["predicted_origins"],
                metric["evaluated_origins"],
            ),
            (2, 2, 1),
        )
        self.assertEqual(metric["label_exclusions"], {"immature_label": 1})
        self.assertIsNone(metric["future_home_threshold_event"]["fpr"])
        self.assertFalse(metric["clinical_performance_claim"])
        self.assertIsNone(summarize([])["forecast_coverage"])
        self.assertIsNone(summarize([])["systolic"]["mae_mmHg"])

    def test_training_purge_enforces_subject_label_end_and_label_availability(self):
        valid = {
            "subject_id": "train",
            "origin": "2026-09-01",
            "label_end": "2026-09-08",
            "label_available_at": "2026-09-10T00:00:00+09:00",
        }
        windows = [
            valid,
            {**valid, "subject_id": "test"},
            {**valid, "label_end": "2026-10-01"},
            {**valid, "label_available_at": "2026-10-01T00:00:00+09:00"},
            {**valid, "origin": "2026-10-01"},
        ]
        self.assertEqual(
            purged_training_windows(windows, {"test"}, date(2026, 10, 1)),
            [valid],
        )

    def test_row_order_does_not_change_forecasts_or_fingerprint(self):
        a = snapshot(self.events, self.subject, self.as_of)
        b = snapshot(list(reversed(self.events)), self.subject, self.as_of)
        self.assertEqual(a.fingerprint, b.fingerprint)
        self.assertEqual(forecast(a), forecast(b))

    def test_invalid_policy_is_rejected(self):
        for changes in (
            {"min_label_days": 8},
            {"min_recent_days": 8},
            {"max_age_days": 0},
            {"lookback_days": 1},
        ):
            with self.assertRaises(ValueError):
                Policy(**changes)

    def test_cache_identity_includes_excluded_records_and_tombstones(self):
        original = snapshot(self.events, self.subject, self.as_of)
        clinic = replace(
            self.events[-1],
            event_id="clinic",
            session_id="clinic-session",
            setting="clinic",
        )
        changed = snapshot(self.events + [clinic], self.subject, self.as_of)
        self.assertEqual(original.features, changed.features)
        self.assertNotEqual(original.excluded, changed.excluded)
        self.assertNotEqual(original.fingerprint, changed.fingerprint)

    def test_real_and_synthetic_data_cannot_be_mixed_for_an_estimate(self):
        events = self.events[:-1] + [replace(self.events[-1], synthetic=False)]
        history = snapshot(events, self.subject, self.as_of)
        self.assertEqual(history.provenance, "mixed")
        self.assertIn("mixed_data_provenance", history.reasons)
        self.assertIsNone(forecast(history)["point"])

    def test_overlapping_target_windows_are_not_counted_as_independent_patients(self):
        origins = [self.end - timedelta(days=8), self.end - timedelta(days=7)]
        result = backtest(
            self.events, self.subject, origins, self.as_of + timedelta(days=2)
        )
        self.assertEqual(
            result["common_evaluation_origins"], [o.isoformat() for o in origins]
        )
        self.assertTrue(
            all(
                metric["evaluated_origins"] == 2
                for metric in result["common_cohort_metrics"].values()
            )
        )

    def test_unbounded_decline_projection_abstains_instead_of_clipping(self):
        events = []
        for e in self.events:
            age = (self.end - e.measured_at.date()).days
            events.append(replace(e, systolic=50 + age * 2, diastolic=30 + age))
        history = snapshot(events, self.subject, self.as_of)
        self.assertTrue(history.eligible)
        result = forecast(history, "damped_trend_28d")
        self.assertEqual(result["status"], "abstained")
        self.assertIn("unsupported_projection", result["quality"]["reasons"])


if __name__ == "__main__":
    unittest.main()
