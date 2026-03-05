"""
Infer a strict snack ranking from binary-choice trials.

Current method (simple, debug-friendly):
- Count how many times each snack is chosen in main (non-practice) trials.
- Sort by win count (desc), tie-break by snack_id (asc) to force strict order.

This is a placeholder for more advanced inference later (e.g., BT model, RT tie-breaks).
"""

import json
from collections import defaultdict


# Keep snack IDs consistent across frontend/backed.
SNACK_IDS = ["snack1", "snack2", "snack3", "snack4", "snack5", "snack6"]


def parse_binary_rows(binary_rows_json):
    """
    Parse the JSON string from Player.binary_rows_json into a list[dict].
    Returns [] if empty or invalid.
    """
    if not binary_rows_json:
        return []
    try:
        data = json.loads(binary_rows_json)
        return data if isinstance(data, list) else []
    except Exception:
        return []


def filter_main_non_timeout(rows):
    """
    Keep only rows that are:
    - main trials (is_practice == 0)
    - non-timeout (is_timeout == 0)
    - have chosen_item_id
    """
    kept = []
    for r in rows:
        if int(r.get("is_practice", 0) or 0) != 0:
            continue
        if int(r.get("is_timeout", 0) or 0) != 0:
            continue
        chosen = (r.get("chosen_item_id") or "").strip()
        if chosen == "":
            continue
        kept.append(r)
    return kept


def infer_ranking_by_win_count(rows):
    """
    Infer ranking via win counts.

    Returns:
        ranking: list[str] best -> worst
        win_counts: dict[str, int]
    """
    win_counts = defaultdict(int)
    for sid in SNACK_IDS:
        win_counts[sid] = 0

    for r in rows:
        chosen = r.get("chosen_item_id")
        if chosen in win_counts:
            win_counts[chosen] += 1

    # Strict order: primary = -wins, secondary = snack_id
    ranking = sorted(SNACK_IDS, key=lambda sid: (-win_counts[sid], sid))
    return ranking, dict(win_counts)