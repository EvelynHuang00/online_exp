import random


def run_rsd(player_ids, rankings):
    """
    Random Serial Dictatorship allocation.

    Args
    ----
    player_ids : list[int]
        Player identifiers (we use id_in_group).

    rankings : dict[int, list[str]]
        Mapping player_id -> ranked snack list (best -> worst).

    Returns
    -------
    assignment : dict[int, str]
        Mapping player_id -> assigned snack.

    order : list[int]
        Random dictatorship order.
    """

    order = player_ids.copy()
    random.shuffle(order)

    # Determine available snacks from the first player's ranking
    available = set(rankings[order[0]])

    assignment = {}

    for pid in order:

        for snack in rankings[pid]:

            if snack in available:
                assignment[pid] = snack
                available.remove(snack)
                break

    return assignment, order