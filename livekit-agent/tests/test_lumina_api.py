import respx
import httpx
from tools.lumina_api import LuminaAPI

BASE = "http://testserver/api"
API = LuminaAPI(base_url=BASE, api_key="test-key")


@respx.mock
async def test_get_lead_returns_dict_and_sends_bearer():
    route = respx.get(f"{BASE}/internal/livekit/leads/abc123").mock(
        return_value=httpx.Response(200, json={"name": "Ravi", "company": "Acme"})
    )
    lead = await API.get_lead("abc123")
    assert lead["name"] == "Ravi"
    assert route.calls[0].request.headers["authorization"] == "Bearer test-key"


@respx.mock
async def test_get_lead_returns_empty_dict_on_404():
    respx.get(f"{BASE}/internal/livekit/leads/missing").mock(
        return_value=httpx.Response(404)
    )
    assert await API.get_lead("missing") == {}


@respx.mock
async def test_post_outcome_true_on_200():
    route = respx.post(f"{BASE}/internal/livekit/calls/c1/outcome").mock(
        return_value=httpx.Response(200, json={"success": True})
    )
    assert await API.post_outcome("c1", "interested", "wants demo") is True
    import json
    body = json.loads(route.calls[0].request.content)
    assert body == {"outcome": "interested", "notes": "wants demo"}


@respx.mock
async def test_post_outcome_false_on_500_no_raise():
    respx.post(f"{BASE}/internal/livekit/calls/c1/outcome").mock(
        return_value=httpx.Response(500)
    )
    assert await API.post_outcome("c1", "interested") is False


@respx.mock
async def test_post_transcript_sends_payload():
    route = respx.post(f"{BASE}/internal/livekit/calls/c1/transcript").mock(
        return_value=httpx.Response(200)
    )
    ok = await API.post_transcript("c1", "hello world", [{"role": "assistant", "content": "hi"}])
    assert ok is True
    import json
    body = json.loads(route.calls[0].request.content)
    assert body["transcript"] == "hello world"
    assert body["conversation_log"][0]["role"] == "assistant"


@respx.mock
async def test_schedule_callback_true_on_200():
    route = respx.post(f"{BASE}/internal/livekit/calls/c1/callback").mock(
        return_value=httpx.Response(200)
    )
    assert await API.schedule_callback("c1", "2026-07-10T15:00:00+05:30", "call back") is True
    import json
    body = json.loads(route.calls[0].request.content)
    assert body == {"date_time": "2026-07-10T15:00:00+05:30", "notes": "call back"}
