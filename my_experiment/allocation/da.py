"""
Deferred Acceptance (DA) placeholder.

This file intentionally does NOT implement DA yet.
Its purpose is to lock down the allocation interface so that:
- the backend page flow (WaitPage / Results) does not need rewriting
- we can later drop in a real DA implementation safely

=== Required function signature ===
    run_da(player_ids, rankings, seed=None, **kwargs) -> (assignment, order, meta)

Inputs
------
player_ids : list[int]
    Participant identifiers within the group. In this project we use Player.id_in_group.
    Example: [1, 2, 3, 4, 5, 6]

rankings : dict[int, list[str]]
    Strict preference ranking for each participant, best -> worst.
    Keys must match player_ids.
    Example:
        {
          1: ["snack4","snack2","snack6","snack1","snack3","snack5"],
          2: ...
        }

seed : int | None
    Optional seed for reproducibility.
    DA may be deterministic given priorities; seed can still be used for:
    - tie-breaking (if you introduce ties or equal priorities)
    - randomized fallback rules
    - debugging reproducibility

kwargs : optional
    Use **kwargs for DA-specific configuration without changing the interface.
    Examples (future): priorities, tie_break_rule, max_rounds, etc.

Outputs
-------
assignment : dict[int, str]
    Mapping from player_id -> assigned snack_id.
    Must be a one-to-one matching for the group (no duplicates, no missing players).
    Example: {1:"snack2", 2:"snack5", ...}

order : list[int] | None
    Optional. For RSD we return the dictator order; for DA you can return:
    - None (if no meaningful "order" exists), OR
    - a list describing proposal order, or any stable debug ordering you want.
    IMPORTANT: Downstream code must not rely on "order" existing for DA.

meta : dict
    Free-form debug info that is safe to store/log.
    Example fields (future): {"algo":"da","seed":..., "rounds":..., "tie_breaks":...}

=== Important invariant ===
The function must be "pure" w.r.t. inputs:
- do not read oTree models here
- do not write to database here
Instead: return assignment/order/meta, and let the WaitPage write results to Player fields.
This keeps DA testable and swappable.

"""

def run_da(player_ids, rankings, seed=None, **kwargs):
    """
    DA placeholder.

    Raise NotImplementedError so we don't accidentally run a half-implemented DA.
    When implementing DA later, keep the return format identical to RSD:
        return assignment, order, meta
    """
    raise NotImplementedError(
        "DA is not implemented yet. Implement run_da(...) following the interface "
        "documented at the top of this file."
    )