"""Versioned research policy, separate from M1 diagnostic/label thresholds.

The home-mean event is a future research outcome, not a diagnosis or treatment
target. Source: Korean Society of Hypertension HBPM position statement (2022),
https://pmc.ncbi.nlm.nih.gov/articles/PMC9526300/ . Support bounds are conservative
engineering limits inherited from prior research-data checks, not clinical
safety thresholds. They MUST be independently revalidated for a real cohort.
"""

from dataclasses import asdict, dataclass

QUALITY_POLICY_VERSION = "bp-history-quality-research-v0"
AGGREGATION_POLICY_VERSION = "session-slot-day-balanced-v0"
HORIZON_DAYS = 7
HOME_EVENT_SBP = 135
HOME_EVENT_DBP = 85
SUPPORT_SBP = (50, 300)
SUPPORT_DBP = (30, 200)


def in_research_support(systolic: float, diastolic: float) -> bool:
    return (
        SUPPORT_SBP[0] <= systolic <= SUPPORT_SBP[1]
        and SUPPORT_DBP[0] <= diastolic <= SUPPORT_DBP[1]
        and systolic > diastolic
    )


@dataclass(frozen=True)
class Policy:
    lookback_days: int = 28
    min_history_days: int = 14
    min_span_days: int = 14
    min_recent_days: int = 5
    min_recent_paired_days: int = 3
    max_age_days: int = 2
    change_washout_days: int = 7
    min_label_days: int = 5
    label_lag_days: int = 2

    def __post_init__(self):
        if any(type(v) is not int or v < 1 for v in asdict(self).values()):
            raise ValueError("positive integer research policy values required")
        if (
            self.lookback_days != 28
            or self.min_history_days > 28
            or self.min_span_days > 28
            or self.min_recent_days > 7
            or self.min_recent_paired_days > self.min_recent_days
            or self.min_label_days > 7
        ):
            raise ValueError("invalid research window policy")


DEFAULT_POLICY = Policy()
