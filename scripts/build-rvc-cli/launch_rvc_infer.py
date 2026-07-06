#!/usr/bin/env python3
"""NEXFLOW 本地 RVC 推理 CLI（供 rvc_infer_cli.exe 或开发态 python 调用）。"""
from __future__ import annotations

import argparse
import os
import sys
import tempfile
from pathlib import Path


def _patch_torch_load_for_fairseq() -> None:
    """PyTorch 2.6+ 默认 weights_only=True，fairseq/rvc 加载 HuBERT 会失败。"""
    try:
        import torch
    except ImportError:
        return
    if getattr(torch.load, "_nexflow_patched", False):
        return

    _orig_load = torch.load

    def _load(*args, **kwargs):
        kwargs.setdefault("weights_only", False)
        return _orig_load(*args, **kwargs)

    _load._nexflow_patched = True  # type: ignore[attr-defined]
    torch.load = _load  # type: ignore[assignment]


_patch_torch_load_for_fairseq()


def _pick_only_cpu(device: str) -> bool:
    if device == "cpu":
        return True
    if device.startswith("cuda"):
        try:
            import torch

            return not torch.cuda.is_available()
        except Exception:
            return True
    return False


def _run_infer_rvc_python_v12(args: argparse.Namespace) -> None:
    from infer_rvc_python import BaseLoader

    hubert = str(Path(args.hubert).resolve())
    rmvpe = str(Path(args.rmvpe).resolve())
    only_cpu = _pick_only_cpu(args.device)
    loader = BaseLoader(only_cpu=only_cpu, hubert_path=hubert, rmvpe_path=rmvpe)
    index = (args.index or "").strip()
    loader.apply_conf(
        tag="nexflow",
        file_model=str(Path(args.model_pth).resolve()),
        pitch_algo="rmvpe+",
        pitch_lvl=int(args.pitch),
        file_index=index,
        index_influence=float(args.index_rate),
        respiration_median_filtering=3,
        envelope_ratio=0.25,
    )
    out_path = str(Path(args.output).resolve())
    inp_path = str(Path(args.input).resolve())
    if hasattr(loader, "infer_file"):
        loader.infer_file(inp_path, out_path)
        return
    if hasattr(loader, "infer_wav"):
        loader.infer_wav(inp_path, out_path)
        return
    if hasattr(loader, "convert_file"):
        loader.convert_file(inp_path, out_path)
        return
    # 部分版本输出到临时目录
    if hasattr(loader, "infer_directory"):
        with tempfile.TemporaryDirectory() as td:
            loader.infer_directory(inp_path, td)
            wavs = list(Path(td).glob("*.wav"))
            if not wavs:
                raise RuntimeError("infer_directory 未产出 wav")
            Path(out_path).write_bytes(wavs[0].read_bytes())
        return
    raise RuntimeError("当前 infer_rvc_python 版本无可用推理接口")


def _detect_rvc_checkpoint_version(model_pth: str) -> str:
    import torch

    cpt = torch.load(model_pth, map_location="cpu")
    if not isinstance(cpt, dict):
        return "v2"
    version = str(cpt.get("version", "v1")).strip().lower()
    return version if version in ("v1", "v2") else "v1"


def _run_rvc_python(args: argparse.Namespace) -> None:
    from rvc_python.infer import RVCInference

    device = "cpu:0" if _pick_only_cpu(args.device) else args.device
    index = (args.index or "").strip() or ""
    version = _detect_rvc_checkpoint_version(args.model_pth)
    rvc = RVCInference(device=device)
    rvc.load_model(args.model_pth, version=version, index_path=index)
    rvc.set_params(f0up_key=int(args.pitch), f0method="rmvpe", index_rate=float(args.index_rate))
    rvc.infer_file(args.input, args.output)


def main() -> int:
    parser = argparse.ArgumentParser(description="NEXFLOW local RVC inference")
    parser.add_argument("--model-pth", required=True)
    parser.add_argument("--index", default="")
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--pitch", type=int, default=0)
    parser.add_argument("--index-rate", type=float, default=0.75)
    parser.add_argument("--hubert", required=True)
    parser.add_argument("--rmvpe", required=True)
    parser.add_argument("--device", default="cuda:0")
    parsed = parser.parse_args()

    for label, p in (("hubert", parsed.hubert), ("rmvpe", parsed.rmvpe), ("model", parsed.model_pth)):
        if not Path(p).is_file():
            print(f"ERROR: missing {label}: {p}", file=sys.stderr)
            return 1
    if not Path(parsed.input).is_file():
        print(f"ERROR: missing input: {parsed.input}", file=sys.stderr)
        return 1

    os.makedirs(os.path.dirname(os.path.abspath(parsed.output)) or ".", exist_ok=True)
    os.environ.setdefault("RVC_HUBERT_PATH", str(Path(parsed.hubert).resolve()))
    os.environ.setdefault("RVC_RMVPE_PATH", str(Path(parsed.rmvpe).resolve()))

    errors: list[str] = []
    try:
        _run_rvc_python(parsed)
        return 0
    except ImportError as exc:
        errors.append(f"rvc-python: {exc}")
    except Exception as exc:
        errors.append(f"rvc-python: {exc}")
    try:
        _run_infer_rvc_python_v12(parsed)
        return 0
    except ImportError as exc:
        errors.append(f"infer-rvc-python: {exc}")
    except Exception as exc:
        errors.append(f"infer-rvc-python: {exc}")
    print("ERROR: RVC 推理后端均不可用:\n" + "\n".join(errors), file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
