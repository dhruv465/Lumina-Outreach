"""Build STT/LLM/TTS plugins from the per-call provider_config dispatched by the
Lumina server (BYO-key SaaS: keys come from the call owner's Configuration,
never from this process's environment)."""

from __future__ import annotations

import logging
from dataclasses import dataclass

from livekit.plugins import anthropic, deepgram, google, openai

logger = logging.getLogger("lumina-outbound")


@dataclass(frozen=True)
class ProviderConfig:
    stt_api_key: str
    stt_model: str
    llm_provider: str
    llm_api_key: str
    llm_model: str
    llm_temperature: float
    tts_api_key: str
    tts_voice: str


def parse_provider_config(meta: dict) -> ProviderConfig | None:
    pc = meta.get("provider_config")
    if not isinstance(pc, dict):
        return None
    try:
        stt, llm, tts = pc["stt"], pc["llm"], pc["tts"]
        cfg = ProviderConfig(
            stt_api_key=stt["api_key"],
            stt_model=stt.get("model", "nova-3"),
            llm_provider=llm["provider"],
            llm_api_key=llm["api_key"],
            llm_model=llm["model"],
            llm_temperature=float(llm.get("temperature", 0.7)),
            tts_api_key=tts["api_key"],
            tts_voice=tts.get("voice", "aura-2-thalia-en"),
        )
    except (KeyError, TypeError, ValueError) as e:
        logger.error("malformed provider_config: %s", e)
        return None
    if not (cfg.stt_api_key and cfg.llm_api_key and cfg.tts_api_key):
        logger.error("provider_config has empty api keys")
        return None
    return cfg


def build_stt(cfg: ProviderConfig) -> deepgram.STT:
    # language="en" matches the barge-in fix (fast interims on PSTN overlap).
    return deepgram.STT(model=cfg.stt_model, language="en", api_key=cfg.stt_api_key)


def build_llm(cfg: ProviderConfig):
    # Step 2 verification (task-6 report) confirmed all three plugin constructors
    # accept `temperature` directly, so the per-call value is wired through rather
    # than relying on each SDK's built-in default.
    if cfg.llm_provider == "openai":
        return openai.responses.LLM(
            model=cfg.llm_model, api_key=cfg.llm_api_key, temperature=cfg.llm_temperature
        )
    if cfg.llm_provider == "anthropic":
        return anthropic.LLM(
            model=cfg.llm_model, api_key=cfg.llm_api_key, temperature=cfg.llm_temperature
        )
    if cfg.llm_provider == "google":
        return google.LLM(
            model=cfg.llm_model, api_key=cfg.llm_api_key, temperature=cfg.llm_temperature
        )
    raise ValueError(f"unknown llm provider: {cfg.llm_provider}")


def build_tts(cfg: ProviderConfig) -> deepgram.TTS:
    # Deepgram Aura: the voice is the TTS model name.
    return deepgram.TTS(model=cfg.tts_voice, api_key=cfg.tts_api_key)
