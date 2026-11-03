"""Ghi results.json trạng thái placeholder: mọi số là null để web hiển thị "chưa đo"."""

import argparse
import sys
from pathlib import Path

from common import DEFAULT_RESULTS, MODES, N_BOOKS, settings
from run_eval import write_results

PLANNED = [("image_aug", MODES, 300), ("text_query", ("text",), 100), ("real_photo", MODES, 20)]


def placeholder(models: dict) -> dict:
    runs = [
        {"set": set_name, "mode": mode, "n": n, "recall_at_1": None, "recall_at_10": None,
         "mrr": None, "latency_p50_ms": None, "latency_p95_ms": None}
        for set_name, modes, n in PLANNED
        for mode in modes
    ]
    return {"status": "placeholder", "generated_at": None, "n_books": N_BOOKS,
            "models": models, "runs": runs, "examples": []}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out", type=Path, default=DEFAULT_RESULTS)
    args = ap.parse_args(argv)
    s = settings()
    write_results(args.out, placeholder({"ocr": s.ocr_model, "embed": s.embed_model, "rerank": s.chat_model}))
    print(f"Đã ghi {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
