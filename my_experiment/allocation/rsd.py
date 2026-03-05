"""
Random Serial Dictatorship (RSD).

Given each participant's strict ranking over snacks, RSD:
1) draws a random permutation of participants
2) iterates in that order, each picks their best available snack

This file only implements RSD. The shared interface is in allocation/__init__.py.
"""

import random


def run_rsd(player_ids, rankings, seed=None):
    """
    Run RSD allocation.

    Args:
        player_ids: list[int]
        rankings: dict[int, list[str]] (best -> worst)
        seed: optional int for reproducibility

    Returns:
        assignment: dict[int, str]
        order: list[int]
        meta: dict (debug info)
    """
    rng = random.Random(seed)

    order = list(player_ids)
    rng.shuffle(order)

    # Available snacks inferred from any player's ranking list.
    # Assumes all players rank the same snack labels.
    first_pid = order[0]
    available = set(rankings[first_pid])

    assignment = {}

    for pid in order:
        for snack_id in rankings[pid]:
            if snack_id in available:
                assignment[pid] = snack_id
                available.remove(snack_id)
                break

    meta = {"seed": seed, "algo": "rsd"}
    return assignment, order, meta