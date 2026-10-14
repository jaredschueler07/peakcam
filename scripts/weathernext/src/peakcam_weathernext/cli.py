"""CLI: probabilities from a fixture/synthetic ensemble; scoring of pairs.

Output is derived values only (probabilities, percentiles of derived
snow totals, member counts). Raw per-member WeatherNext values are
never emitted, per the real-time terms (derived Value Added Service).
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from .accumulate import PowderProbabilities, WindowResult, compute_probabilities
from .derive import METHOD_VERSION
from .score import brier_score, brier_skill_score, expected_calibration_error, reliability_bins
from .sources import FixtureSource, SyntheticSource
from .types import ResortPoint


def _window_json(w: WindowResult) -> dict:
    return {
        "kind": w.kind,
        "valid_start": w.valid_start.isoformat(),
        "valid_end": w.valid_end.isoformat(),
        "n_valid": w.n_valid,
        "n_members": w.n_members,
        "degraded": w.degraded,
        "p_ge": {f"{int(k)}in": round(v, 4) for k, v in w.p_ge.items()},
        "members_ge": {f"{int(k)}in": v for k, v in w.members_ge.items()},
        "percentiles_in": {f"p{k}": round(v, 2) for k, v in w.percentiles_in.items()},
        "mean_in": round(w.mean_in, 2),
    }


def _probabilities_json(r: PowderProbabilities) -> dict:
    return {
        "slug": r.slug,
        "model_init_at": r.init_time.isoformat(),
        "first_issuable_hour": r.t0.isoformat(),
        "method_version": METHOD_VERSION,
        "horizon_truncated": r.horizon_truncated,
        "next_72h": _window_json(r.next_window),
        "best_7d": _window_json(r.best_window),
        "any_window_7d_diagnostic": _window_json(r.any_window),
        "attribution": "Experimental - derived by PeakCam from Google WeatherNext 3 ensemble data; not an official forecast",
    }


def _cmd_probabilities(args: argparse.Namespace) -> int:
    point = ResortPoint(slug=args.slug, lat=args.lat, lng=args.lng, elev_m=args.elev_m)
    if args.fixture:
        source = FixtureSource(args.fixture)
        init_time = source.latest_available_init(now=datetime.now(timezone.utc))
        assert init_time is not None
    else:
        source = SyntheticSource(seed=args.seed, n_members=args.members)
        init_time = source.latest_available_init(now=datetime.now(timezone.utc))
        assert init_time is not None
    series = source.fetch_point_ensemble(
        init_time=init_time, points=[point], horizon_hours=args.horizon_hours
    )
    result = compute_probabilities(
        series, point, point_index=series.slugs.index(point.slug),
        window_hours=args.window_hours, horizon_hours=args.horizon_hours,
    )
    print(json.dumps(_probabilities_json(result), indent=2))
    return 0


def _cmd_score(args: argparse.Namespace) -> int:
    doc = json.loads(Path(args.pairs).read_text(encoding="utf-8"))
    p = np.asarray(doc["probabilities"], dtype=np.float64)
    y = np.asarray(doc["outcomes"], dtype=np.float64)
    out = {
        "n": int(p.size),
        "brier": brier_score(p, y),
        "brier_skill_vs_climatology": brier_skill_score(p, y),
        "ece": expected_calibration_error(p, y),
        "reliability_bins": [asdict(b) for b in reliability_bins(p, y)],
    }
    print(json.dumps(out, indent=2))
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="peakcam-weathernext")
    sub = parser.add_subparsers(dest="command", required=True)
    prob = sub.add_parser("probabilities", help="derived powder probabilities for one point")
    prob.add_argument("--fixture", help="JSON/CSV ensemble fixture (default: synthetic)")
    prob.add_argument("--slug", default="synthetic-resort")
    prob.add_argument("--lat", type=float, default=39.5)
    prob.add_argument("--lng", type=float, default=-106.0)
    prob.add_argument("--elev-m", type=float, default=3000.0)
    prob.add_argument("--window-hours", type=int, default=72)
    prob.add_argument("--horizon-hours", type=int, default=168)
    prob.add_argument("--seed", type=int, default=0)
    prob.add_argument("--members", type=int, default=8)
    prob.set_defaults(fn=_cmd_probabilities)
    score = sub.add_parser("score", help="Brier/reliability for forecast-outcome pairs")
    score.add_argument("--pairs", required=True, help="JSON {probabilities: [...], outcomes: [...]}")
    score.set_defaults(fn=_cmd_score)
    args = parser.parse_args(argv)
    return int(args.fn(args))


if __name__ == "__main__":
    sys.exit(main())
