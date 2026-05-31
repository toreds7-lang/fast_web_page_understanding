"""OpenAI client. Supports vLLM-compatible endpoints via LLM_BASE_URL."""
from openai import OpenAI

from config import OPENAI_API_KEY, LLM_MODEL, LLM_BASE_URL


def _make_client() -> OpenAI:
    if LLM_BASE_URL:
        return OpenAI(api_key="EMPTY", base_url=LLM_BASE_URL)
    return OpenAI(api_key=OPENAI_API_KEY)


_client: OpenAI = _make_client()


def stream_messages(messages: list[dict], model: str = LLM_MODEL):
    """Yield content tokens from a streaming chat completion."""
    with _client.chat.completions.create(
        model=model, messages=messages, stream=True
    ) as stream:
        for event in stream:
            token = event.choices[0].delta.content or ""
            if token:
                yield token


def complete_messages(
    messages: list[dict],
    model: str = LLM_MODEL,
    json_mode: bool = False,
    max_tokens: int | None = None,
) -> str:
    """Return the full assistant message from a non-streaming chat completion.

    Used when the whole response is needed at once (e.g. JSON graph extraction)
    rather than streamed token-by-token. When ``json_mode`` is set, ask the API
    to constrain output to a valid JSON object (OpenAI's response_format); if the
    endpoint doesn't support it, fall back to a plain completion."""
    kwargs: dict = {"model": model, "messages": messages, "stream": False}
    if max_tokens:
        kwargs["max_tokens"] = max_tokens
    if json_mode:
        try:
            resp = _client.chat.completions.create(
                response_format={"type": "json_object"}, **kwargs
            )
            return resp.choices[0].message.content or ""
        except Exception:
            pass  # endpoint may not support response_format — retry plainly
    resp = _client.chat.completions.create(**kwargs)
    return resp.choices[0].message.content or ""
