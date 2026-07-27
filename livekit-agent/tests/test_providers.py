import pytest

from providers import ProviderConfig, parse_provider_config, build_llm, build_stt, build_tts

VALID_META = {
    "call_id": "abc",
    "provider_config": {
        "stt": {"api_key": "dg-key", "model": "nova-3"},
        "llm": {"provider": "openai", "api_key": "sk-oai", "model": "gpt-4.1", "temperature": 0.7},
        "tts": {"api_key": "dg-key", "voice": "aura-luna-en"},
    },
}


def cfg_for(provider: str, stt_model: str = "nova-3") -> ProviderConfig:
    return ProviderConfig(
        stt_api_key="dg-key", stt_model=stt_model,
        llm_provider=provider, llm_api_key="k", llm_model="m", llm_temperature=0.7,
        tts_api_key="dg-key", tts_voice="aura-luna-en",
    )


def test_parse_valid_metadata():
    cfg = parse_provider_config(VALID_META)
    assert cfg is not None
    assert cfg.stt_api_key == "dg-key"
    assert cfg.llm_provider == "openai"
    assert cfg.tts_voice == "aura-luna-en"


@pytest.mark.parametrize("meta", [
    {},                                             # missing block
    {"provider_config": None},                      # null
    {"provider_config": {"stt": {}}},               # missing sections
    {"provider_config": {"stt": {"api_key": ""}, "llm": {}, "tts": {}}},  # empty keys
])
def test_parse_rejects_bad_metadata(meta):
    assert parse_provider_config(meta) is None


@pytest.mark.parametrize("provider", ["azure", "OpenAI", ""])
def test_parse_rejects_unsupported_llm_provider(provider):
    meta = {
        "provider_config": {
            "stt": {"api_key": "dg-key", "model": "nova-3"},
            "llm": {"provider": provider, "api_key": "sk", "model": "m", "temperature": 0.7},
            "tts": {"api_key": "dg-key", "voice": "aura-luna-en"},
        },
    }
    assert parse_provider_config(meta) is None


def test_build_stt_and_tts_are_deepgram():
    from livekit.plugins import deepgram
    cfg = cfg_for("openai")
    assert isinstance(build_stt(cfg), deepgram.STT)
    assert isinstance(build_tts(cfg), deepgram.TTS)


def test_build_stt_requests_numerals():
    # Callback times and quantities must reach the LLM as digits.
    assert build_stt(cfg_for("openai"))._opts.numerals is True


def test_build_stt_passes_keyterms_on_nova_3():
    stt = build_stt(cfg_for("openai"), keyterms=["Lumina", "Ravi"])
    assert stt._opts.keyterm == ["Lumina", "Ravi"]


def test_build_stt_omits_keyterms_on_older_models():
    # Keyterm prompting is a nova-3 feature; nova-2 rejects the parameter.
    stt = build_stt(cfg_for("openai", stt_model="nova-2"), keyterms=["Lumina"])
    assert not stt._opts.keyterm


def test_build_stt_without_keyterms_is_unchanged():
    assert not build_stt(cfg_for("openai"))._opts.keyterm


def test_build_llm_selects_plugin_per_provider():
    from livekit.plugins import anthropic, google
    assert isinstance(build_llm(cfg_for("anthropic")), anthropic.LLM)
    assert isinstance(build_llm(cfg_for("google")), google.LLM)
    build_llm(cfg_for("openai"))  # constructs without raising


def test_build_llm_rejects_unknown_provider():
    with pytest.raises(ValueError):
        build_llm(cfg_for("azure"))
