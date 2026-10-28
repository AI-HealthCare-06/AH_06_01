import json
import unittest
from handler import create_handler, saved_profile_input, UpstreamError


class Predictor:
    def __init__(self): self.inputs = []
    def predict(self, payload):
        self.inputs.append(payload)
        return {"data_quality": "not_applicable" if "blood_pressure" in payload else "partial"}


class HandlerTests(unittest.TestCase):
    def setUp(self):
        self.model = Predictor()
        self.calls = []
        self.remote = {"health_profile": {"age": 52, "sex": "male", "height_cm": 170,
            "weight_kg": 75, "onboarding_bp_text": None, "fasting_glucose": 102,
            "details": {"alcoholDays": 3, "conditions": [], "hypertensionFamily": False,
                "activeMinutesWeek": 150, "sleepHours": 7}}, "medications": []}
        def call(path, token, **kw):
            self.calls.append((path, token))
            if path == "/auth/v1/user": return {"id":"owner"}
            if "user_consents" in path: return [{"version":"health-cloud-v1"}]
            if "health_profiles" in path: return [self.remote["health_profile"]]
            if "medications" in path: return self.remote["medications"]
            return self.remote
        self.call = call
        self.handle = create_handler(call, lambda: self.model)

    def event(self, body="{}", path="/v1/predictions/bp-stage"):
        return {"rawPath": path,"requestContext":{"http":{"method":"POST"}},
            "headers":{"Authorization":"Bearer synthetic"}, "body":body}

    def test_saved_profile_uses_verified_user_rls_without_identity_in_body(self):
        response = self.handle(self.event())
        self.assertEqual(response["statusCode"], 200)
        self.assertTrue(all(t == "Bearer synthetic" for _,t in self.calls))
        self.assertNotIn("alcohol_week", self.model.inputs[0])
        self.assertNotIn("name", self.model.inputs[0])
        self.assertEqual(self.handle(self.event('{"user_id":"other"}'))["statusCode"],400)

    def test_auth_and_consent_are_enforced_before_model_load(self):
        event = self.event(); event["headers"] = {}
        self.assertEqual(self.handle(event)["statusCode"],401)
        handler = create_handler(lambda path,*a,**k: {"id":"owner"} if path == "/auth/v1/user" else [], lambda: self.fail("loaded model before consent"))
        self.assertEqual(handler(self.event())["statusCode"],403)

    def test_measurement_and_htn_med_remain_exclusions(self):
        self.remote["health_profile"]["onboarding_bp_text"]="128 / 82"
        out = json.loads(self.handle(self.event())["body"])
        self.assertEqual(out["data_quality"],"not_applicable")
        self.remote["health_profile"]["details"]["htnStatus"]="on_medication"
        self.assertTrue(saved_profile_input(self.remote)["htn_med"])

    def test_zero_days_is_zero_drinks_but_unknown_is_not_false(self):
        details = self.remote["health_profile"]["details"]
        details["alcoholDays"] = 0
        self.assertEqual(saved_profile_input(self.remote)["alcohol_week"],0)
        details["hypertensionFamily"] = None
        self.assertNotIn("family_htn",saved_profile_input(self.remote))

    def test_none_is_an_observed_negative_and_unknown_stays_missing(self):
        details = self.remote["health_profile"]["details"]
        details.update(conditionStatus="none", conditions=[], hypertensionFamily=False,
            alcoholDays=0, alcoholWeek=None, bingeMonthly=None, educationYears=0)
        payload = saved_profile_input(self.remote)
        self.assertIs(payload["dm_dx"], False)
        self.assertIs(payload["family_htn"], False)
        self.assertEqual(payload["alcohol_week"], 0)
        self.assertIs(payload["binge"], False)
        self.assertEqual(payload["education_years"], 0)
        details["conditionStatus"] = "unknown"
        self.assertNotIn("dm_dx", saved_profile_input(self.remote))
        del details["conditionStatus"]
        self.assertIs(saved_profile_input(self.remote)["dm_dx"], False)

    def test_reference_inputs_are_forwarded_without_guessing_drinking_amounts(self):
        details = self.remote["health_profile"]["details"]
        details.update(waistCm=85, restingHeartRate=65, educationYears=12,
            alcoholDays=2, alcoholWeek=8, bingeMonthly=False)
        payload = saved_profile_input(self.remote)
        for key, value in {"waist_cm":85,"resting_hr":65,"education_years":12,
            "alcohol_week":8,"binge":False}.items():
            self.assertEqual(payload[key], value)

    def test_transport_validation_and_domain_response_are_separate(self):
        for body in ["[]", "{", '{"age":true}', '{"age":42.5}', '{"bmi":NaN}']:
            self.assertEqual(self.handle(self.event(body,path="/predictions/bp-stage"))["statusCode"],400)
        self.assertEqual(self.handle(self.event('{"age":95}',path="/predictions/bp-stage"))["statusCode"],200)

    def test_failure_never_reflects_credentials_or_health_values(self):
        def fail(*a,**k): raise UpstreamError(401)
        response=create_handler(fail)(self.event())
        self.assertEqual(response["statusCode"],401)
        self.assertNotIn("synthetic",response["body"])
        self.assertEqual(response["headers"]["cache-control"],"no-store")

    def test_health_checks_the_model_load_instead_of_static_metadata(self):
        event={"rawPath":"/predictions/bp-stage/health","requestContext":{"http":{"method":"GET"}}}
        self.assertTrue(json.loads(self.handle(event)["body"])["ready"])
        def fail(): raise RuntimeError("private-path")
        response=create_handler(self.call,fail)(event)
        self.assertEqual(response["statusCode"],503)
        self.assertNotIn("private-path",response["body"])

    def test_supabase_invalid_jwt_responses_all_map_to_unauthorized(self):
        for status in (400,401,403):
            def fail(*a,**k): raise UpstreamError(status)
            response=create_handler(fail)(self.event())
            self.assertEqual(response["statusCode"],401)

if __name__ == "__main__": unittest.main()
