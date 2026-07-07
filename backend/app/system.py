"""Runtime environment + resource usage for the live UI panel:
Python version, platform, CPU, RAM, and GPU/VRAM (via nvidia-smi if present).
"""
import platform
import shutil
import subprocess

try:
    import psutil
except ImportError:  # keep the app importable even if psutil is missing
    psutil = None


def _gpu_info() -> list[dict]:
    exe = shutil.which("nvidia-smi")
    if not exe:
        return []
    try:
        out = subprocess.run(
            [exe, "--query-gpu=name,memory.total,memory.used,utilization.gpu",
             "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=3,
        )
        gpus = []
        for line in out.stdout.strip().splitlines():
            parts = [x.strip() for x in line.split(",")]
            if len(parts) < 4:
                continue
            name, mt, mu, ut = parts[:4]
            gpus.append({
                "name": name,
                "vram_total_mb": float(mt),
                "vram_used_mb": float(mu),
                "util_percent": float(ut),
            })
        return gpus
    except Exception:
        return []


def system_info() -> dict:
    info = {
        "python_version": platform.python_version(),
        "platform": platform.system(),
        "platform_detail": platform.platform(),
        "gpus": _gpu_info(),
    }
    if psutil is not None:
        vm = psutil.virtual_memory()
        info.update({
            "cpu_count": psutil.cpu_count(logical=True),
            "cpu_percent": psutil.cpu_percent(interval=0.15),
            "ram_total_mb": round(vm.total / 1e6, 1),
            "ram_used_mb": round(vm.used / 1e6, 1),
            "ram_percent": vm.percent,
        })
        try:
            info["process_ram_mb"] = round(psutil.Process().memory_info().rss / 1e6, 1)
        except Exception:
            pass
    else:
        info["note"] = "psutil not installed; CPU/RAM unavailable"
    try:
        from . import sandbox
        info["sandbox"] = sandbox.describe()
    except Exception:
        pass
    try:
        from . import runners
        info["runners"] = runners.describe()
    except Exception:
        pass
    return info
