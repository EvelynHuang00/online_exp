"""
my_experiment.inference.ranking

Infer a strict snack ranking from binary-choice trials.

Current design (per updated experiment design):
- Score each snack by **win-count**: number of valid main-task trials in which
  the participant chose that snack.
- If multiple snacks share the same win-count, break ties by RANDOMLY
  permuting the snacks within each tie group.
- Record tie-group membership (grouped by identical win-count) so downstream
  exports can mark tie groups without redundant columns.

Notes
-----
A "valid" trial means:
- main task (not practice),
- not timeout,
- and has a non-empty chosen_item_id.

Random tie-breaking is seeded (caller provides a seed) so the result is
reproducible.
"""

import json
import random
from collections import defaultdict


# IMPORTANT: Keep snack IDs consistent across frontend/back-end.
SNACK_IDS = ["snack1", "snack2", "snack3", "snack4", "snack5", "snack6"]


def parse_binary_rows(binary_rows_json):
    """
    Parse Player.binary_rows_json into a list[dict].

    Returns:
        list[dict]: trial rows, or [] if empty/invalid.
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
    Keep only VALID rows:
    - main trials: is_practice == 0
    - non-timeout: is_timeout == 0
    - chosen_item_id is non-empty
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
    (Legacy helper) Infer ranking via win counts.

    WARNING:
    - This function breaks ties deterministically by snack_id (NOT random).
    - Kept only for backwards compatibility / debugging.

    Returns:
        ranking (list[str]): best -> worst (strict)
        win_counts (dict[str, int])
    """
    win_counts = defaultdict(int)
    for sid in SNACK_IDS:
        win_counts[sid] = 0

    for r in rows:
        chosen = (r.get("chosen_item_id") or "").strip()
        if chosen in win_counts:
            win_counts[chosen] += 1

    # Deterministic tie-break by snack_id (legacy behavior).
    ranking = sorted(SNACK_IDS, key=lambda sid: (-win_counts[sid], sid))
    return ranking, dict(win_counts)


def infer_ranking_win_count_random_ties(rows, seed):
    """
    Infer strict ranking using win-count scoring + random tie-breaking.

    Args:
        rows (list[dict]): VALID rows (caller should filter first).
        seed (int): seed for reproducible tie-breaking.

    Returns:
        ranking (list[str]): best -> worst (strict)
        win_counts (dict[str, int])
        tie_group_id_by_snack (dict[str, int]):
            1 = highest win-count group, larger = lower win-count groups.
        final_rank_by_snack (dict[str, int]):
            final strict rank after tie-breaking (1..6).
    """
    rng = random.Random(int(seed))

    # 1) Win-counts
    win_counts = {sid: 0 for sid in SNACK_IDS}
    for r in rows:
        chosen = (r.get("chosen_item_id") or "").strip()
        if chosen in win_counts:
            win_counts[chosen] += 1

    # 2) Tie groups by identical win-count, ordered by win-count descending.
    unique_scores = sorted({win_counts[sid] for sid in SNACK_IDS}, reverse=True)
    tie_group_id_by_score = {score: idx + 1 for idx, score in enumerate(unique_scores)}
    tie_group_id_by_snack = {
        sid: tie_group_id_by_score[win_counts[sid]] for sid in SNACK_IDS
    }

    # 3) Strict ranking: randomize within each tie group.
    ranking = []
    for score in unique_scores:
        members = [sid for sid in SNACK_IDS if win_counts[sid] == score]
        rng.shuffle(members)  # <-- the only tie-break rule now
        ranking.extend(members)

    final_rank_by_snack = {sid: idx + 1 for idx, sid in enumerate(ranking)}
    return ranking, win_counts, tie_group_id_by_snack, final_rank_by_snack