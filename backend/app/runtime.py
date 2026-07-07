"""Colab-like runtime control: choose which compute device experiments use,
and expose it as env vars injected into every experiment subprocess.

device values:
  auto  -> leave GPUs visible (use GPU if the code/torch supports it)
  cpu   -> hide all GPUs (CUDA_VISIBLE_DEVICES="")
  "0"   -> pin to a specific GPU index
"""
_state: dict = {"device": "auto"}


def get_device() -> str:
    return _state["device"]


def set_device(device: str) -> None:
    _state["device"] = device or "auto"


def cuda_env() -> dict:
    d = _state["device"]
    if d in ("auto", "all"):
        return {}
    if d == "cpu":
        return {"CUDA_VISIBLE_DEVICES": "-1"}
    return {"CUDA_VISIBLE_DEVICES": str(d)}
