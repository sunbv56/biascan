import math


def rank_of(expected_id: str, ids: list[str]) -> int | None:
    try:
        return ids.index(expected_id) + 1
    except ValueError:
        return None


def recall_at(ranks: list[int | None], k: int) -> float | None:
    if not ranks:
        return None
    return sum(1 for r in ranks if r is not None and r <= k) / len(ranks)


def mrr(ranks: list[int | None], k: int = 10) -> float | None:
    if not ranks:
        return None
    return sum(1.0 / r for r in ranks if r is not None and r <= k) / len(ranks)


def percentile(values: list[float], p: float) -> float | None:
    if not values:
        return None
    xs = sorted(values)
    pos = (len(xs) - 1) * p / 100.0
    lo, hi = math.floor(pos), math.ceil(pos)
    return xs[lo] + (xs[hi] - xs[lo]) * (pos - lo)


def summarize(ranks: list[int | None], latencies_ms: list[float]) -> dict:
    def rnd(x, nd):
        return None if x is None else round(x, nd)

    p50, p95 = percentile(latencies_ms, 50), percentile(latencies_ms, 95)
    return {
        "n": len(ranks),
        "recall_at_1": rnd(recall_at(ranks, 1), 4),
        "recall_at_10": rnd(recall_at(ranks, 10), 4),
        "mrr": rnd(mrr(ranks, 10), 4),
        "latency_p50_ms": None if p50 is None else int(round(p50)),
        "latency_p95_ms": None if p95 is None else int(round(p95)),
    }
