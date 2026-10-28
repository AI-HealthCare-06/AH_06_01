import json
import unittest
from datetime import date, timedelta
from handler import create_handler
from quest_analysis import analysis_response, demo_remote

class AnalysisTests(unittest.TestCase):
    def result(self):
        return {"stage_top": None, "data_quality": "not_applicable"}
    def test_demo_executes_original_m2_and_preserves_m1_exclusion(self):
        remote = demo_remote(date(2026,10,22))
        out = analysis_response(self.result(), remote, synthetic=True, as_of=date(2026,10,22))
        self.assertEqual(out["m1"]["data_quality"], "not_applicable")
        self.assertEqual(out["m1_bridge"], {"step":"htn","source":"medication-contract"})
        self.assertEqual(out["m2"]["data_quality"], "ok")
        self.assertEqual(out["m2"]["states"]["NOCTURNAL_SCREEN"]["status"], "positive")
        self.assertEqual(out["m2"]["states"]["HTN_SUSPECT"]["status"], "not_evaluable")
        self.assertEqual(out["previous_day"]["completed_quests"], ["meal","water","survey"])
        self.assertEqual(out["previous_day"]["sleep_hours"], 5.6)
    def test_demo_surveys_drive_daily_model_inputs_and_seven_day_activity(self):
        from daily_inputs import daily_record, weekly_activity
        from handler import saved_profile_input
        current = date(2026,10,27)
        remote = demo_remote(current)
        surveys = remote["game"]["dailySurveys"]
        self.assertEqual(len(surveys), 7)
        self.assertEqual(sorted(surveys), [(current - timedelta(days=i)).isoformat() for i in range(6,-1,-1)])
        self.assertEqual(surveys["2026-10-24"]["daytimeSleepinessScore"], 0)
        self.assertFalse(surveys["2026-10-24"]["daytimeSleepiness"])
        self.assertEqual(weekly_activity(remote,current),90)
        latest = daily_record(remote,current)
        self.assertEqual(latest["bedtime"],"23:48")
        payload = saved_profile_input(remote,current)
        self.assertEqual(payload["sleep_hours"],6.2)
        self.assertEqual(payload["resting_hr"],80)
        self.assertEqual(payload["fasting_glucose"],150)
        self.assertEqual(payload["blood_pressure"],"148 / 94")
        self.assertEqual(payload["activity_minutes_week"],90)
        out = analysis_response(self.result(), remote, synthetic=True, as_of=current)
        self.assertEqual(out["daily_survey_date"],current.isoformat())
        self.assertEqual(out["m2"]["states"]["NOCTURNAL_SCREEN"]["status"],"positive")

    def test_missing_real_inputs_never_inherit_synthetic_symptoms_or_history(self):
        remote=demo_remote(date(2026,10,22))
        remote.pop("game")
        out=analysis_response(self.result(),remote,as_of=date(2026,10,22))
        self.assertIsNone(out["previous_day"]["completed_quests"])
        self.assertIsNone(out["previous_day"]["sleep_hours"])
        self.assertEqual(out["m2"]["states"]["NOCTURNAL_SCREEN"]["status"],"not_evaluable")
    def test_public_demo_only_accepts_fixed_payload_and_other_requests_require_auth(self):
        class Model:
            def predict(_,payload): return self.result()
        handle=create_handler(lambda *args,**kwargs:self.fail("public fixture must not read user data"),lambda:Model())
        event={"rawPath":"/predictions/bp-stage","requestContext":{"http":{"method":"POST"}},"body":json.dumps({"demo_persona":"htn-diabetes-v1"})}
        self.assertEqual(handle(event)["statusCode"],200)
        event["body"]=json.dumps({"demo_persona":"htn-diabetes-v1","age":80})
        self.assertEqual(handle(event)["statusCode"],401)
        event["body"]="{}"
        self.assertEqual(handle(event)["statusCode"],401)

    def test_private_analysis_reads_history_with_the_same_verified_caller(self):
        remote=demo_remote(date.today())
        remote["game"].pop("dailySurveys")
        calls=[]
        class Model:
            def predict(_,payload): return self.result()
        def call(path,token,**kwargs):
            calls.append((path,token))
            if path == "/auth/v1/user": return {"id":"synthetic-owner"}
            if "user_consents" in path: return [{"version":"health-cloud-v1"}]
            if "health_profiles" in path: return [remote["health_profile"]]
            if "medications" in path: return remote["medications"]
            if "game_saves" in path: return [{"snapshot":remote["game"]}]
            self.fail("Unexpected storage read")
        handle=create_handler(call,lambda:Model())
        event={"rawPath":"/v1/predictions/bp-stage","requestContext":{"http":{"method":"POST"}},"headers":{"Authorization":"Bearer synthetic"},"body":'{"include_m2":true}'}
        response=handle(event)
        self.assertEqual(response["statusCode"],200)
        output=json.loads(response["body"])
        self.assertEqual(output["source"],"saved-profile")
        self.assertEqual(output["previous_day"]["completed_quests"],["meal","water","survey"])
        self.assertEqual(output["m2"]["states"]["NOCTURNAL_SCREEN"]["status"],"not_evaluable")
        self.assertTrue(all(token == "Bearer synthetic" for _,token in calls))
        self.assertTrue(any("game_saves" in path for path,_ in calls))
        for body in ['{"include_m2":1}', '{"include_m2":false}', '{"include_m2":true,"user_id":"other"}']:
            event["body"]=body
            self.assertEqual(handle(event)["statusCode"],400)

    def test_private_analysis_stops_before_history_and_model_without_consent(self):
        def call(path,*args,**kwargs):
            if path == "/auth/v1/user": return {"id":"synthetic-owner"}
            if "user_consents" in path: return []
            self.fail("Storage read before consent")
        handle=create_handler(call,lambda:self.fail("Model loaded before consent"))
        event={"rawPath":"/v1/predictions/bp-stage","requestContext":{"http":{"method":"POST"}},"headers":{"Authorization":"Bearer synthetic"},"body":'{"include_m2":true}'}
        self.assertEqual(handle(event)["statusCode"],403)

if __name__ == "__main__": unittest.main()
