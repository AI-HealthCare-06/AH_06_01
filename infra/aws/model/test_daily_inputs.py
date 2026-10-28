from datetime import date, timedelta
from handler import saved_profile_input
from daily_inputs import weekly_activity
from quest_analysis import demo_remote, analysis_response


def record(day, **extra):
    return {"date":day.isoformat(),"submittedAt":1,"bloodPressureStatus":"measured",
        "morning":{"systolic":148,"diastolic":94},"evening":None,
        "sleepHours":5.5,"restingHr":78,"fastingGlucose":154,"activeMinutes":0,
        "sedentaryHours":8,"snoring":False,"daytimeSleepiness":False,"nocturia":False,**extra}


def test_today_values_override_profile_but_bp_still_excludes_m1_prediction():
    day=date(2026,10,27); remote=demo_remote(day)
    remote['game']['dailySurveys']={day.isoformat():record(day)}
    payload=saved_profile_input(remote,day)
    assert payload['sleep_hours']==5.5 and payload['resting_hr']==78
    assert payload['fasting_glucose']==154 and payload['blood_pressure']=='148 / 94'
    assert 'sbp' not in payload and 'dbp' not in payload
    remote['game']['dailySurveys'][day.isoformat()].update(sleepHours=None,restingHr=None,fastingGlucose=None)
    payload=saved_profile_input(remote,day)
    assert all(key not in payload for key in ['sleep_hours','resting_hr','fasting_glucose'])


def test_weekly_activity_requires_seven_dates_and_preserves_observed_zero():
    day=date(2026,10,27); remote=demo_remote(day)
    remote['game']['dailySurveys']={(day-timedelta(days=i)).isoformat():record(day-timedelta(days=i)) for i in range(7)}
    assert weekly_activity(remote,day)==0
    del remote['game']['dailySurveys'][(day-timedelta(days=3)).isoformat()]
    assert weekly_activity(remote,day) is None


def test_m2_uses_dated_answers_and_does_not_inherit_demo_answers():
    day=date(2026,10,27); remote=demo_remote(day)
    remote['game']['dailySurveys']={day.isoformat():record(day)}
    result=analysis_response({'stage_top':None,'data_quality':'not_applicable'},remote,synthetic=True,as_of=day)
    assert result['daily_survey_date']==day.isoformat()
    state=result['m2']['states']['NOCTURNAL_SCREEN']
    assert state['status']=='not_evaluable'
    assert state['evidence']['symptoms']=={'snoring':False,'daytime_sleepiness':False,'nocturia':False}
    assert state['missing_required']==['m1_bp_step.evening_step']
    remote['game']['dailySurveys'][day.isoformat()].update(snoring=None,daytimeSleepiness=None,nocturia=None)
    result=analysis_response({'stage_top':None,'data_quality':'not_applicable'},remote,synthetic=True,as_of=day)
    assert result['m2']['states']['NOCTURNAL_SCREEN']['status']=='not_evaluable'
    assert 'sleep_snoring' in result['m2']['states']['NOCTURNAL_SCREEN']['missing_required']
