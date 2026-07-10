"""HTTP client for the Lumina Fastify internal API.

Tools must never raise into the LLM loop: failures return falsy values so the
agent can respond gracefully mid-call.
"""
import logging

import httpx

logger = logging.getLogger("lumina-api")


class LuminaAPI:
    def __init__(self, base_url: str, api_key: str, timeout: float = 5.0) -> None:
        self._base_url = base_url.rstrip("/")
        self._headers = {"Authorization": f"Bearer {api_key}"}
        self._timeout = timeout

    async def _request(self, method: str, path: str, json: dict | None = None) -> httpx.Response | None:
        url = f"{self._base_url}{path}"
        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                resp = await client.request(method, url, headers=self._headers, json=json)
                return resp
        except httpx.HTTPError as e:
            logger.error("Lumina API %s %s failed: %s", method, path, e)
            return None

    async def get_lead(self, lead_id: str) -> dict:
        resp = await self._request("GET", f"/internal/livekit/leads/{lead_id}")
        if resp is not None and resp.status_code == 200:
            return resp.json()
        return {}

    async def post_outcome(self, call_id: str, outcome: str, notes: str = "") -> bool:
        resp = await self._request(
            "POST",
            f"/internal/livekit/calls/{call_id}/outcome",
            json={"outcome": outcome, "notes": notes},
        )
        return resp is not None and resp.status_code == 200

    async def post_transcript(self, call_id: str, transcript: str, conversation_log: list[dict]) -> bool:
        resp = await self._request(
            "POST",
            f"/internal/livekit/calls/{call_id}/transcript",
            json={"transcript": transcript, "conversation_log": conversation_log},
        )
        return resp is not None and resp.status_code == 200

    async def schedule_callback(self, call_id: str, datetime_iso: str, notes: str = "") -> bool:
        resp = await self._request(
            "POST",
            f"/internal/livekit/calls/{call_id}/callback",
            json={"date_time": datetime_iso, "notes": notes},
        )
        return resp is not None and resp.status_code == 200
