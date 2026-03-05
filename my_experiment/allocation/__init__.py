"""
Allocation algorithms (mechanisms) live here.

Each algorithm should expose a function that returns:
- assignment: dict[player_id -> snack_id]
- order: list[player_id] or None (if not applicable)
- meta: dict for optional debugging / logging

This makes it easy to swap RSD with DA later without rewriting page logic.
"""

from .rsd import run_rsd
from .da import run_da


def run_allocation(algo_name, player_ids, rankings, seed=None):
    """
    Unified entry point for allocation algorithms.

    Args:
        algo_name: str, e.g. "rsd" (later "da")
        player_ids: list[int] (we use Player.id_in_group)
        rankings: dict[int, list[str]] strict ranking (best -> worst)
        seed: optional int seed for reproducibility

    Returns:
        assignment, order, meta
    """
    algo_name = (algo_name or "").lower().strip()

    if algo_name == "rsd":
        return run_rsd(player_ids=player_ids, rankings=rankings, seed=seed)

    # For future only:
    if algo_name == "da":
        # DA NOTE: Keep the call signature consistent with RSD so the rest of the app
        # can switch algorithms without rewriting page logic.
        return run_da(player_ids=player_ids, rankings=rankings, seed=seed, **kwargs)

    raise ValueError(f"Unknown allocation algorithm: {algo_name}")